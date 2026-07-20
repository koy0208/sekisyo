import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3"
import { unstable_cache } from "next/cache"
import { MARTS_CACHE_TAG } from "@/lib/marts"

// face_align Lambda が生成する整列済み顔写真 (data/photos_aligned/) の一覧層。
// ファイル名 (YYYYMMDD_HHMMSSxxx.jpg) に撮影日時が入っているため
// 一覧 + 名前パースだけで時系列に並べられる。画像本体は /api/photos/[file] が配信する。

const BUCKET = process.env.MART_BUCKET || "fitbit-dashboard"
export const ALIGNED_PHOTOS_PREFIX = "data/photos_aligned/"

export type FacePhoto = {
  file: string // 例: "20231225_194534512.jpg"
  date: string // 例: "2023-12-25"
}

const FILE_PATTERN = /^(\d{4})(\d{2})(\d{2})_\d+\.jpe?g$/i

async function listFacePhotosUncached(): Promise<FacePhoto[]> {
  const client = new S3Client({
    region: process.env.AWS_REGION || "ap-northeast-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
    },
  })

  const files: string[] = []
  let continuationToken: string | undefined
  do {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: ALIGNED_PHOTOS_PREFIX,
        ContinuationToken: continuationToken,
      })
    )
    for (const obj of res.Contents ?? []) {
      if (obj.Key) files.push(obj.Key.slice(ALIGNED_PHOTOS_PREFIX.length))
    }
    continuationToken = res.NextContinuationToken
  } while (continuationToken)

  return files
    .map((file) => {
      const m = file.match(FILE_PATTERN)
      if (!m) return null
      return { file, date: `${m[1]}-${m[2]}-${m[3]}` }
    })
    .filter((p): p is FacePhoto => p !== null)
    .sort((a, b) => a.file.localeCompare(b.file))
}

// 写真は週次同期でしか増えないので marts と同じく 1 時間キャッシュ。
// marts タグを共有し、手動同期 (revalidateTag) でも一覧が更新される
export const listFacePhotos = unstable_cache(
  listFacePhotosUncached,
  ["face-photos"],
  { revalidate: 3600, tags: [MARTS_CACHE_TAG] }
)
