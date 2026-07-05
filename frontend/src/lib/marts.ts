import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3"
import { unstable_cache } from "next/cache"

// S3 の marts/*.json を読む薄い層 (docs/redesign/02-data-layer.md)。
// マートは日次バッチ (mart_builder Lambda) が生成し、表示パスはここだけを読む。
// データ更新は 1 日 1 回なので TTL 1 時間でキャッシュする。

const BUCKET = process.env.MART_BUCKET || "fitbit-dashboard"

// 手動更新(sync-runner)後に revalidateTag("marts") で一括無効化できるようタグを付ける
export const MARTS_CACHE_TAG = "marts"

async function getObjectTextUncached(key: string): Promise<string | null> {
  const client = new S3Client({
    region: process.env.AWS_REGION || "ap-northeast-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
    },
  })
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
    return (await res.Body?.transformToString()) ?? null
  } catch (error) {
    // 存在しない日付の timeline_days/*.json などは「データなし」として扱う
    if (error instanceof Error && error.name === "NoSuchKey") return null
    throw error
  }
}

const getObjectText = unstable_cache(getObjectTextUncached, ["mart-json"], {
  revalidate: 3600,
  tags: [MARTS_CACHE_TAG],
})

export async function fetchMart<T>(name: string): Promise<T> {
  const text = await getObjectText(`marts/${name}`)
  if (text === null) throw new Error(`mart not found: ${name}`)
  return JSON.parse(text) as T
}

// 404 を null で返す版 (存在しない日付ファイルが正常系のマート用)
export async function fetchMartOrNull<T>(name: string): Promise<T | null> {
  const text = await getObjectText(`marts/${name}`)
  return text === null ? null : (JSON.parse(text) as T)
}

// キャッシュを通さない版。手動更新の完了検知 (meta.json の generated_at 監視) 用
export async function fetchMartFresh<T>(name: string): Promise<T | null> {
  const text = await getObjectTextUncached(`marts/${name}`)
  return text === null ? null : (JSON.parse(text) as T)
}
