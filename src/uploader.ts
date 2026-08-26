import { Foto } from "./types";

/**
 * Creates a lightweight 400x400 center-cropped thumbnail for grid list rendering.
 * Does NOT touch or alter the original file.
 */
export const createThumbnail = (file: File): Promise<Blob> => {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const origWidth = img.naturalWidth || img.width;
        const origHeight = img.naturalHeight || img.height;
        const minSide = Math.min(origWidth, origHeight);
        const sx = (origWidth - minSide) / 2;
        const sy = (origHeight - minSide) / 2;

        const canvas = document.createElement("canvas");
        canvas.width = 400;
        canvas.height = 400;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          return resolve(file);
        }

        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, 400, 400);

        canvas.toBlob(
          (blob) => {
            resolve(blob || file);
          },
          "image/webp",
          0.75
        );
      } catch (e) {
        console.warn("Could not generate thumbnail, falling back to original", e);
        resolve(file);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };

    img.src = url;
  });
};

/**
 * Captures the first frame of a video as a 400x400 center-cropped WebP thumbnail.
 * Falls back to the original file if the browser cannot decode the frame.
 */
export const createVideoThumbnail = (file: File): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.crossOrigin = "anonymous";

    const cleanup = () => URL.revokeObjectURL(url);

    video.onloadeddata = () => {
      // Seek a tiny bit forward to avoid a black first frame on some codecs.
      // Using a very small offset avoids buffering/decoding the whole file.
      try {
        video.currentTime = 0.01;
      } catch {
        /* ignore */
      }
    };

    video.onseeked = () => {
      try {
        const vw = video.videoWidth || 400;
        const vh = video.videoHeight || 400;
        const minSide = Math.min(vw, vh);
        const sx = (vw - minSide) / 2;
        const sy = (vh - minSide) / 2;

        const canvas = document.createElement("canvas");
        canvas.width = 400;
        canvas.height = 400;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          cleanup();
          return resolve(file);
        }
        ctx.drawImage(video, sx, sy, minSide, minSide, 0, 0, 400, 400);
        canvas.toBlob(
          (blob) => {
            cleanup();
            resolve(blob || file);
          },
          "image/webp",
          0.75
        );
      } catch (e) {
        cleanup();
        resolve(file);
      }
    };

    video.onerror = () => {
      cleanup();
      reject(new Error("Não foi possível gerar a miniatura do vídeo."));
    };
  });
};

const safeJsonParse = async (res: Response): Promise<any> => {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    if (res.status === 503 || res.status === 502 || res.status === 504) {
      throw new Error("O servidor Node.js na Hostinger está temporariamente indisponível ou iniciando (Status 503). Verifique se o aplicativo Node.js está Ativo no painel da Hostinger.");
    }
    throw new Error(`Resposta inválida do servidor (HTTP ${res.status}).`);
  }
};

/**
 * Uploads a photo directly to MinIO with 100% original resolution & quality,
 * plus a lightweight thumbnail for fast mobile grid performance.
 */
/**
 * Uploads a single part of a multipart upload with a per-part timeout and
 * automatic retries. This makes large uploads resilient on flaky 4G.
 */
const uploadPart = (
  blob: Blob,
  url: string,
  partNumber: number,
  contentType: string,
  onProgress?: (loaded: number) => void,
  timeoutMs = 50 * 60 * 1000
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const attempt = (retriesLeft: number) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", url);
      xhr.timeout = timeoutMs;

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(e.loaded);
      };

      const fail = () => {
        if (retriesLeft > 0) attempt(retriesLeft - 1);
        else reject(new Error(`Falha no envio da parte ${partNumber} (HTTP ${xhr.status}).`));
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(xhr.getResponseHeader("ETag") || "");
        } else {
          fail();
        }
      };
      xhr.onerror = fail;
      xhr.ontimeout = fail;
      xhr.send(blob);
    };
    attempt(2); // 3 total attempts per part
  });
};

/**
 * Uploads a file using S3/MinIO multipart: splits into chunks, uploads each
 * with its own timeout + retry, and returns the collected part info.
 */
const uploadFileMultipart = async (
  file: File,
  opts: { partUrls: string[]; chunkSize: number; totalParts: number; contentType: string; onProgress?: (pct: number) => void }
): Promise<{ PartNumber: number; ETag: string }[]> => {
  const { partUrls, chunkSize, totalParts, contentType, onProgress } = opts;
  const parts: { PartNumber: number; ETag: string }[] = [];

  for (let i = 0; i < totalParts; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    const blob = file.slice(start, end);
    const partNumber = i + 1;

    const etag = await uploadPart(
      blob,
      partUrls[i],
      partNumber,
      contentType,
      (loaded) => {
        if (onProgress) {
          const overall = Math.min(99, Math.round(((start + loaded) / file.size) * 100));
          onProgress(overall);
        }
      }
    );
    parts.push({ PartNumber: partNumber, ETag: etag });
  }
  return parts;
};

/** Uploads a small thumbnail blob via a single PUT (non-fatal, no progress). */
const uploadThumbnail = (thumbBlob: Blob, url: string): Promise<void> => {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", "image/webp");
    xhr.onload = () => resolve();
    xhr.onerror = () => {
      console.warn("Thumbnail upload failed (non-fatal)");
      resolve();
    };
    xhr.send(thumbBlob);
  });
};

/**
 * Uploads a photo to MinIO using resilient multipart upload + a lightweight
 * WebP thumbnail for fast mobile grid rendering.
 */
export const uploadPhotoDirect = async (
  file: File,
  deviceId: string,
  onProgress?: (pct: number) => void,
  submissionId?: string
): Promise<Foto> => {
  const originalContentType = file.type || "image/jpeg";

  const initRes = await fetch("/api/upload/multipart-init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      deviceId,
      submissionId,
      filename: file.name,
      contentType: originalContentType,
      size: file.size,
      kind: "photo",
    }),
  });
  const initData = await safeJsonParse(initRes);
  if (!initRes.ok) {
    throw new Error(initData.error || "Falha ao iniciar o envio da foto.");
  }

  // Generate + upload thumbnail in parallel (non-fatal) so the original
  // upload begins immediately instead of waiting for the image to decode.
  const thumbPromise = (async () => {
    try {
      const thumbBlob = await createThumbnail(file);
      if (initData.thumbnailUploadUrl) await uploadThumbnail(thumbBlob, initData.thumbnailUploadUrl);
    } catch (e) {
      console.warn("Thumbnail generation failed (non-fatal)", e);
    }
  })();

  // Multipart upload of the original (starts right away)
  const parts = await uploadFileMultipart(file, {
    partUrls: initData.partUrls,
    chunkSize: initData.chunkSize,
    totalParts: initData.totalParts,
    contentType: originalContentType,
    onProgress,
  });

  // Ensure thumbnail is stored before finalizing (non-fatal)
  await thumbPromise;

  const completeRes = await fetch("/api/upload/multipart-complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: initData.id,
      key: initData.key,
      uploadId: initData.uploadId,
      parts,
      kind: "photo",
      thumbnailKey: initData.thumbnailKey,
    }),
  });
  const completeData = await safeJsonParse(completeRes);
  if (!completeRes.ok) {
    throw new Error(completeData.error || "Falha ao finalizar a foto no banco de dados.");
  }

  if (onProgress) onProgress(100);
  return completeData.foto;
};

/**
 * Uploads a video to MinIO using resilient multipart upload + a first-frame
 * WebP thumbnail for fast mobile grid rendering.
 */
export const uploadVideoDirect = async (
  file: File,
  deviceId: string,
  onProgress?: (pct: number) => void,
  submissionId?: string
): Promise<Foto> => {
  const contentType = file.type || "video/mp4";

  const initRes = await fetch("/api/upload/multipart-init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      contentType,
      deviceId,
      submissionId,
      size: file.size,
      kind: "video",
    }),
  });
  const initData = await safeJsonParse(initRes);
  if (!initRes.ok) {
    throw new Error(initData.error || "Falha ao obter autorização para o vídeo.");
  }

  // Upload ONLY the original here. The first-frame thumbnail is generated
  // AFTER this finishes (see below) so decoding the 150MB video on the main
  // thread never blocks the upload progress or freezes the UI.
  const parts = await uploadFileMultipart(file, {
    partUrls: initData.partUrls,
    chunkSize: initData.chunkSize,
    totalParts: initData.totalParts,
    contentType,
    onProgress,
  });

  const completeRes = await fetch("/api/upload/multipart-complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: initData.id,
      key: initData.key,
      uploadId: initData.uploadId,
      parts,
      kind: "video",
      thumbnailReady: false,
      thumbnailKey: initData.thumbnailKey,
    }),
  });
  const completeData = await safeJsonParse(completeRes);
  if (!completeRes.ok) {
    throw new Error(completeData.error || "Falha ao registrar o vídeo no banco de dados.");
  }

  // Generate the first-frame webp thumbnail AFTER the upload finishes, so the
  // heavy video decode never blocks the upload progress (no freeze during the
  // upload). The webp is uploaded to thumbs/ and the DB url_thumbnail is
  // updated, so the gallery shows a real image instead of a black <video>.
  const fotoId = (completeData.foto && completeData.foto.id) || initData.id;
  if (fotoId && initData.thumbnailUploadUrl) {
    setTimeout(() => {
      generateAndUploadVideoThumbnail(
        file,
        initData.thumbnailUploadUrl,
        initData.thumbnailKey,
        fotoId
      ).catch((e) => console.warn("Video thumbnail generation failed (non-fatal)", e));
    }, 1500);
  }

  if (onProgress) onProgress(100);
  return completeData.foto;
};

/**
 * Generates the first-frame thumbnail for a video and uploads it, then updates
 * the database record. Runs AFTER the main upload (deferred) so decoding the
 * video never blocks the upload progress or the UI during the upload.
 */
const generateAndUploadVideoThumbnail = async (
  file: File,
  thumbnailUploadUrl: string,
  thumbnailKey: string,
  fotoId: string
): Promise<void> => {
  const thumbBlob = await createVideoThumbnail(file);
  await uploadThumbnail(thumbBlob, thumbnailUploadUrl);
  await fetch("/api/upload/set-thumbnail", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: fotoId, thumbnailKey }),
  });
};

