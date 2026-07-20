'use client'

import { useEffect, useRef, useState } from "react"
import { Pause, Play, SkipBack, SkipForward } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { FacePhoto } from "@/lib/mart-types"

// 顔タイムラプスの操作 UI。
// 写真は整列済み (両目が固定座標) なので、単純に img を差し替えるだけで
// ブレのないコマ送りになる。全画像 (~50KB × 100枚強) をバックグラウンドで
// 順次プリロードし、再生時のチラつきを防ぐ。

const PLAY_INTERVAL_MS = 150

function photoUrl(file: string): string {
  return `/api/photos/${file}`
}

// "2023-12-25" → "2023年12月25日"
function formatDate(date: string): string {
  const [y, m, d] = date.split("-")
  return `${y}年${Number(m)}月${Number(d)}日`
}

function FaceImage({ photo, priority }: { photo: FacePhoto; priority?: boolean }) {
  return (
    // 512×512 の生成済み画像なので next/image の最適化は不要 (かえって
    // Cloudflare 上で変換コストがかかる)。素の img + プロキシの immutable キャッシュで返す
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={photoUrl(photo.file)}
      alt={`${photo.date} の顔写真`}
      loading={priority ? "eager" : "lazy"}
      className="aspect-square w-full rounded-lg border bg-muted object-cover"
    />
  )
}

function Scrubber({ photos }: { photos: FacePhoto[] }) {
  const [index, setIndex] = useState(photos.length - 1)
  const [playing, setPlaying] = useState(false)
  const playRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // 全画像をバックグラウンドで順次プリロード (ブラウザキャッシュに乗せる)
  useEffect(() => {
    let cancelled = false
    const preload = async () => {
      for (const photo of photos) {
        if (cancelled) return
        await new Promise<void>((resolve) => {
          const img = new Image()
          img.onload = () => resolve()
          img.onerror = () => resolve()
          img.src = photoUrl(photo.file)
        })
      }
    }
    void preload()
    return () => {
      cancelled = true
    }
  }, [photos])

  // 自動再生: 先頭に戻ってループ
  useEffect(() => {
    if (!playing) return
    playRef.current = setInterval(() => {
      setIndex((i) => (i + 1) % photos.length)
    }, PLAY_INTERVAL_MS)
    return () => {
      if (playRef.current) clearInterval(playRef.current)
    }
  }, [playing, photos.length])

  // 矢印キーでコマ送り
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        setPlaying(false)
        setIndex((i) => Math.min(i + 1, photos.length - 1))
      } else if (e.key === "ArrowLeft") {
        setPlaying(false)
        setIndex((i) => Math.max(i - 1, 0))
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [photos.length])

  const current = photos[index]

  return (
    <div className="mx-auto w-full max-w-md space-y-4">
      <FaceImage photo={current} priority />

      <div className="text-center">
        <p className="text-lg font-semibold tabular-nums">{formatDate(current.date)}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {index + 1} / {photos.length} 枚
        </p>
      </div>

      <input
        type="range"
        min={0}
        max={photos.length - 1}
        value={index}
        onChange={(e) => {
          setPlaying(false)
          setIndex(Number(e.target.value))
        }}
        className="w-full accent-primary"
        aria-label="日付スライダー"
      />

      <div className="flex items-center justify-center gap-2">
        <Button
          variant="outline"
          size="icon"
          onClick={() => {
            setPlaying(false)
            setIndex(0)
          }}
          aria-label="最初へ"
        >
          <SkipBack className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? "一時停止" : "再生"}
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={() => {
            setPlaying(false)
            setIndex(photos.length - 1)
          }}
          aria-label="最後へ"
        >
          <SkipForward className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

function ComparePanel({
  photos,
  label,
  index,
  onChange,
}: {
  photos: FacePhoto[]
  label: string
  index: number
  onChange: (index: number) => void
}) {
  const photo = photos[index]
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <FaceImage photo={photo} priority />
      <p className="text-center text-sm font-semibold tabular-nums">
        {formatDate(photo.date)}
      </p>
      <input
        type="range"
        min={0}
        max={photos.length - 1}
        value={index}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary"
        aria-label={`${label}の日付スライダー`}
      />
    </div>
  )
}

function Compare({ photos }: { photos: FacePhoto[] }) {
  const [beforeIndex, setBeforeIndex] = useState(0)
  const [afterIndex, setAfterIndex] = useState(photos.length - 1)

  return (
    <div className="mx-auto grid w-full max-w-2xl grid-cols-2 gap-4">
      <ComparePanel
        photos={photos}
        label="Before"
        index={beforeIndex}
        onChange={setBeforeIndex}
      />
      <ComparePanel
        photos={photos}
        label="After"
        index={afterIndex}
        onChange={setAfterIndex}
      />
    </div>
  )
}

export function FaceTimelapse({ photos }: { photos: FacePhoto[] }) {
  return (
    <Card>
      <CardContent>
        <Tabs defaultValue="timelapse">
          <TabsList>
            <TabsTrigger value="timelapse">タイムラプス</TabsTrigger>
            <TabsTrigger value="compare">比較</TabsTrigger>
          </TabsList>
          <TabsContent value="timelapse" className="pt-2">
            <Scrubber photos={photos} />
          </TabsContent>
          <TabsContent value="compare" className="pt-2">
            <Compare photos={photos} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
