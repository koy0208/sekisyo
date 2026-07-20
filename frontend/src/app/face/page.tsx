import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DataError } from "@/components/shared/data-error"
import { FaceTimelapse } from "@/components/face/face-timelapse"
import { fetchMart } from "@/lib/marts"
import { type FacePhotosMart } from "@/lib/mart-types"
import { settle } from "@/lib/utils"

export const dynamic = "force-dynamic"
export const runtime = "edge"

// 顔の記録ビュー。
// face_align Lambda が両目の位置を揃えた 512×512 写真を生成しているため、
// スライダー/自動再生でパラパラ漫画的に顔の変化を追える。
// 一覧は Lambda が生成する marts/face_photos.json を読む
// (表示パスで S3 List は使わない。docs/redesign/02-data-layer.md)

export default async function FacePage() {
  const mart = await settle(fetchMart<FacePhotosMart>("face_photos.json"), "face photos mart")
  const photos = mart?.photos ?? null

  return (
    <div className="flex-col md:flex">
      <div className="flex-1 space-y-4 p-4 md:p-8 md:pt-6">
        <h2 className="text-2xl md:text-3xl font-bold tracking-tight">顔の記録</h2>
        <p className="text-sm text-muted-foreground">
          顔写真の履歴を目の位置基準で整列したタイムラプス。スライダーのドラッグ・矢印キー・自動再生で変化を追える。
        </p>

        {photos === null ? (
          <Card>
            <CardHeader>
              <CardTitle>タイムラプス</CardTitle>
            </CardHeader>
            <CardContent>
              <DataError />
            </CardContent>
          </Card>
        ) : photos.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>タイムラプス</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                整列済みの写真がまだありません。face-align-lambda の backfill 実行後に表示されます。
              </p>
            </CardContent>
          </Card>
        ) : (
          <FaceTimelapse photos={photos} />
        )}
      </div>
    </div>
  )
}
