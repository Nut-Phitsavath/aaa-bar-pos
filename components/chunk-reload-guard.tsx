"use client"

import { useEffect } from "react"

// Kiosk safeguard. After a redeploy, Next.js content-hashes chunk filenames, so
// they change. A long-open kiosk tab (or a stale browser/edge cache) can then
// request an old or half-written chunk and crash with ChunkLoadError /
// "Loading chunk ... failed" / ERR_CONTENT_DECODING_FAILED. We force a single
// hard reload so the page fetches the current HTML + chunks. A sessionStorage
// timestamp prevents reload loops if the asset is genuinely broken.
export function ChunkReloadGuard() {
    useEffect(() => {
        const KEY = "chunk-reload-ts"
        const isChunkError = (msg?: string | null) =>
            !!msg && (/ChunkLoadError/i.test(msg) ||
                /Loading chunk [\w-]+ failed/i.test(msg) ||
                /Loading CSS chunk/i.test(msg) ||
                /ERR_CONTENT_DECODING_FAILED/i.test(msg) ||
                /_next\/static/i.test(msg))

        const reloadOnce = () => {
            const last = Number(sessionStorage.getItem(KEY) || 0)
            // At most one auto-reload per 15s, so a permanently broken asset
            // doesn't put the kiosk into a reload loop.
            if (Date.now() - last > 15000) {
                sessionStorage.setItem(KEY, String(Date.now()))
                window.location.reload()
            }
        }

        const onError = (e: ErrorEvent) => { if (isChunkError(e.message)) reloadOnce() }
        const onRejection = (e: PromiseRejectionEvent) => {
            const reason: any = e.reason
            const msg = typeof reason === "string" ? reason : reason?.message
            if (isChunkError(msg)) reloadOnce()
        }

        window.addEventListener("error", onError)
        window.addEventListener("unhandledrejection", onRejection)
        return () => {
            window.removeEventListener("error", onError)
            window.removeEventListener("unhandledrejection", onRejection)
        }
    }, [])

    return null
}
