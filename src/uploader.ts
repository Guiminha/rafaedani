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
export const uploadPhotoDirect = async (
  file: File,
  deviceId: string,
  onProgress?: (pct: number) => void
): Promise<Foto> => {
  // 1. Generate thumbnail in memory (original file remains 100% untouched)
  const thumbBlob = await createThumbnail(file);

  // 2. Request presigned URLs
  const originalContentType = file.type || "image/jpeg";
  const presignedRes = await fetch("/api/photo/presigned", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      deviceId,
      filename: file.name,
      originalContentType,
      thumbContentType: "image/webp",
    }),
  });

  const presignedData = await safeJsonParse(presignedRes);
  if (!presignedRes.ok) {
    throw new Error(presignedData.error || "Falha ao obter autorização de envio.");
  }

  // 3. Upload untouched original file directly to MinIO
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", presignedData.originalUploadUrl);
    xhr.setRequestHeader("Content-Type", presignedData.originalContentType || originalContentType);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        const pct = Math.round((e.loaded / e.total) * 90); // 0-90% for original upload
        onProgress(pct);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Falha no upload do arquivo original para o MinIO (HTTP ${xhr.status})`));
      }
    };

    xhr.onerror = () => reject(new Error("Erro de conexão ao enviar o arquivo original para o MinIO."));
    xhr.ontimeout = () => reject(new Error("Tempo limite excedido ao enviar o arquivo."));
    xhr.send(file);
  });

  // 4. Upload thumbnail directly to MinIO
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", presignedData.thumbnailUploadUrl);
    xhr.setRequestHeader("Content-Type", "image/webp");

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        if (onProgress) onProgress(95);
        resolve();
      } else {
        // Thumbnail failure is non-fatal; we can still finalize
        console.warn("Thumbnail upload returned", xhr.status);
        resolve();
      }
    };

    xhr.onerror = () => {
      console.warn("Thumbnail upload network error");
      resolve();
    };

    xhr.send(thumbBlob);
  });

  // 5. Finalize photo metadata in Supabase
  const finalizeRes = await fetch("/api/photo/finalize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: presignedData.id,
      originalKey: presignedData.originalKey,
      thumbnailKey: presignedData.thumbnailKey,
      deviceId,
    }),
  });

  const finalizeData = await safeJsonParse(finalizeRes);
  if (!finalizeRes.ok) {
    throw new Error(finalizeData.error || "Falha ao registrar a foto no banco de dados.");
  }

  if (onProgress) onProgress(100);
  return finalizeData.foto;
};

/**
 * Uploads a video directly to MinIO with 100% original quality.
 */
export const uploadVideoDirect = async (
  file: File,
  deviceId: string,
  onProgress?: (pct: number) => void
): Promise<Foto> => {
  const res = await fetch("/api/video/presigned", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type || "video/mp4",
      deviceId,
    }),
  });

  const data = await safeJsonParse(res);
  if (!res.ok) {
    throw new Error(data.error || "Falha ao obter autorização para o vídeo.");
  }

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", data.uploadUrl);
    xhr.setRequestHeader("Content-Type", file.type || "video/mp4");

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        const pct = Math.round((e.loaded / e.total) * 95);
        onProgress(pct);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Falha no upload do vídeo (HTTP ${xhr.status})`));
      }
    };

    xhr.onerror = () => reject(new Error("Erro de conexão ao enviar o vídeo para o MinIO."));
    xhr.ontimeout = () => reject(new Error("Tempo limite excedido ao enviar o vídeo."));
    xhr.send(file);
  });

  const finalizeRes = await fetch("/api/video/finalize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: data.id, key: data.key, deviceId }),
  });

  const finalizeData = await safeJsonParse(finalizeRes);
  if (!finalizeRes.ok) {
    throw new Error(finalizeData.error || "Falha ao registrar o vídeo no banco de dados.");
  }

  if (onProgress) onProgress(100);
  return finalizeData.foto;
};
