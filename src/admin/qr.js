import { useEffect, useState } from 'react'

// The QR library is a file of its own, downloaded the first time a QR is drawn (the QR dialog, a printed sign), not with
// the committee app: only those two use it. Every file of the app is in the precache (vite.config.js), so an installed app
// has it offline too. A download that failed fails again until the page is loaded again: the browser keeps the failure of
// a module's download for as long as the page is open, so the screens say to refresh the page.
const loadQrCode = () => import('qrcode').then((module) => module.default)

/** A crisp, scannable QR as a PNG data URL. Level M leaves room to survive a scuffed print. */
export const qrDataUrl = async (text, width = 720) => {
  const QRCode = await loadQrCode()
  return QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin: 2, width, color: { dark: '#000000', light: '#ffffff' } })
}

/**
 * The QR image of `text`: `{ src, failed }`. `src` is the data URL, null while it is being made; `failed` says that it could
 * not be made (its library did not download).
 */
export function useQrImage(text) {
  const [image, setImage] = useState({ src: null, failed: false })
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
  }, [text])
  return image
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
