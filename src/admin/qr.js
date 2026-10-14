import { useCallback, useEffect, useState } from 'react'

// The QR library is a file of its own, downloaded the first time a QR is drawn (the QR dialog, a printed sign), not with
// the committee app: only those two use it. Every file of the app is in the precache (vite.config.js), so an installed app
// has it offline too. The import is made on every call and its promise is not kept: the browser keeps the module once it
// has loaded, and a download that failed is tried again on the next call ("try again" in the dialog, printing again).
const loadQrCode = () => import('qrcode').then((module) => module.default)

/** A crisp, scannable QR as a PNG data URL. Level M leaves room to survive a scuffed print. */
export const qrDataUrl = async (text, width = 720) => {
  const QRCode = await loadQrCode()
  return QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin: 2, width, color: { dark: '#000000', light: '#ffffff' } })
}

/**
 * The QR image of `text`: `{ src, failed, retry }`. `src` is the data URL, null while it is being made; `failed` says that it
 * could not be made (its library did not download), and `retry` tries again.
 */
export function useQrImage(text) {
  const [image, setImage] = useState({ src: null, failed: false })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let cancelled = false
    setImage({ src: null, failed: false })
    if (text) {
      qrDataUrl(text).then(
        (src) => !cancelled && setImage({ src, failed: false }),
        () => !cancelled && setImage({ src: null, failed: true }),
      )
    }
    return () => {
      cancelled = true
    }
  }, [text, attempt])
  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  return { ...image, retry }
}

export function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/** File-name-safe version of a point name (Hebrew stays readable). */
export const safeFileName = (name) => name.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'qr'
