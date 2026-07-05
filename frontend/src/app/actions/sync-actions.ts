'use server'

import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda"
import { revalidateTag } from "next/cache"
import { fetchMartFresh, MARTS_CACHE_TAG } from "@/lib/marts"
import type { MartMeta } from "@/lib/mart-types"

// データ連携の手動トリガー。sync-runner Lambda (gdrive →
// タイムライン変換待ち → mart_builder) を非同期で起動する。
// fitbit は毎日の自動実行に任せ、手動更新の対象外。
// 多重実行は Lambda 側の reserved_concurrent_executions = 1 で抑止される
export async function triggerSync(): Promise<{ ok: boolean }> {
  const client = new LambdaClient({
    region: process.env.AWS_REGION || "ap-northeast-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
    },
  })
  await client.send(
    new InvokeCommand({ FunctionName: "sync-runner-lambda", InvocationType: "Event" })
  )
  return { ok: true }
}

// 完了検知用: マートの生成時刻をキャッシュを通さず読む。
// mart_builder は meta.json を最後に書くため、これが更新完了のマーカーになる
export async function getMartGeneratedAt(): Promise<string | null> {
  try {
    const meta = await fetchMartFresh<MartMeta>("meta.json")
    return meta?.generated_at ?? null
  } catch {
    return null
  }
}

// 完了後にサーバ側のマートキャッシュ (TTL 1h) を無効化する
export async function refreshMartCache(): Promise<void> {
  revalidateTag(MARTS_CACHE_TAG)
}
