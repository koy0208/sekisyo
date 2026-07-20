import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3"

export const runtime = "edge"

const ALIGNED_PHOTOS_PREFIX = "data/photos_aligned/"

// 整列済み顔写真の配信プロキシ。
// presigned URL は URL さえ知っていれば Cloudflare Access を迂回して
// 閲覧できてしまうため、同一オリジンの route handler で返す
// (オリジン全体が Access 保護下にあるので追加の認証実装は不要)。
// 写真は不変なので immutable でエッジ/ブラウザに長期キャッシュさせる。

const BUCKET = process.env.MART_BUCKET || "fitbit-dashboard"

// パストラバーサル防止: 写真ファイル名の形式のみ許可
const FILE_PATTERN = /^\d{8}_\d+\.jpe?g$/i

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ file: string }> }
) {
  const { file } = await params
  if (!FILE_PATTERN.test(file)) {
    return new Response("Not Found", { status: 404 })
  }

  const client = new S3Client({
    region: process.env.AWS_REGION || "ap-northeast-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
    },
  })

  try {
    const res = await client.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: `${ALIGNED_PHOTOS_PREFIX}${file}` })
    )
    if (!res.Body) return new Response("Not Found", { status: 404 })

    return new Response(res.Body.transformToWebStream(), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    })
  } catch (error) {
    if (error instanceof Error && error.name === "NoSuchKey") {
      return new Response("Not Found", { status: 404 })
    }
    throw error
  }
}
