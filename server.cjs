var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_fs = __toESM(require("fs"), 1);
var import_os = __toESM(require("os"), 1);
var import_express = __toESM(require("express"), 1);
var import_path = __toESM(require("path"), 1);
var import_multer = __toESM(require("multer"), 1);
var import_client_s3 = require("@aws-sdk/client-s3");
var import_s3_request_presigner = require("@aws-sdk/s3-request-presigner");
var import_supabase_js = require("@supabase/supabase-js");
var import_uuid = require("uuid");
var import_cors = __toESM(require("cors"), 1);
var import_dotenv = __toESM(require("dotenv"), 1);
import_dotenv.default.config();
var sharp = null;
try {
  sharp = require("sharp");
  if (sharp) {
    sharp.cache(false);
    sharp.concurrency(1);
  }
} catch (e) {
  console.warn("Sharp native module not available or failed to load. Image processing will run in fallback mode.", e);
}
var app = (0, import_express.default)();
var PORT = process.env.PORT || 3e3;
app.use((0, import_cors.default)());
app.use(import_express.default.json());
app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    uptime: process.uptime(),
    supabaseConfigured: !!supabase,
    minioConfigured: !!s3,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
});
process.on("uncaughtException", (err) => {
  console.error("\u26A0\uFE0F Uncaught Exception in server process:", err);
});
process.on("unhandledRejection", (reason, promise) => {
  console.error("\u26A0\uFE0F Unhandled Rejection at:", promise, "reason:", reason);
});
var supabaseUrl = process.env.SUPABASE_URL;
var supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
var supabase = null;
try {
  if (supabaseUrl && supabaseKey) {
    supabase = (0, import_supabase_js.createClient)(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
    console.log("\u2705 Supabase client initialized successfully.");
  } else {
    console.warn("\u26A0\uFE0F Supabase credentials are not set. Database operations will run in memory fallback mode.");
  }
} catch (err) {
  console.error("Failed to initialize Supabase:", err);
}
var minioEndpoint = process.env.MINIO_ENDPOINT;
var minioPort = process.env.MINIO_PORT;
var minioUseSSL = process.env.MINIO_USE_SSL !== "false";
var minioAccessKey = process.env.MINIO_ACCESS_KEY;
var minioSecretKey = process.env.MINIO_SECRET_KEY;
var bucketName = process.env.MINIO_BUCKET_NAME;
var s3 = null;
try {
  if (minioEndpoint && minioAccessKey && minioSecretKey) {
    let endpointUrl = minioEndpoint;
    if (!endpointUrl.startsWith("http://") && !endpointUrl.startsWith("https://")) {
      const protocol = minioUseSSL ? "https" : "http";
      const portStr = minioPort ? `:${minioPort}` : "";
      endpointUrl = `${protocol}://${minioEndpoint}${portStr}`;
    }
    s3 = new import_client_s3.S3Client({
      region: "auto",
      // S3Client handles 'auto' well for non-AWS S3
      endpoint: endpointUrl,
      credentials: {
        accessKeyId: minioAccessKey,
        secretAccessKey: minioSecretKey
      },
      forcePathStyle: true
      // Required for MinIO
    });
    if (!process.env.MINIO_PUBLIC_URL) {
      process.env.MINIO_PUBLIC_URL = `${endpointUrl}/${bucketName}`;
    }
  } else {
    console.warn("MinIO credentials are not set. File uploads will fail.");
  }
} catch (err) {
  console.error("Failed to initialize S3 client:", err);
}
var minioPublicUrl = (process.env.MINIO_PUBLIC_URL || "").replace(/\/$/, "");
var publicBaseUrl = minioPublicUrl.endsWith(`/${bucketName}`) ? minioPublicUrl : minioPublicUrl ? `${minioPublicUrl}/${bucketName}` : "";
var upload = (0, import_multer.default)({ dest: import_os.default.tmpdir() });
var deviceLimits = /* @__PURE__ */ new Map();
var RATE_LIMIT_WINDOW_MS = 10 * 60 * 1e3;
var RATE_LIMIT_MAX_SUBMISSIONS = 5;
var MAX_VIDEO_SIZE = 150 * 1024 * 1024;
var MULTIPART_CHUNK_SIZE = 10 * 1024 * 1024;
function checkRateLimit(deviceId, submissionId) {
  if (!deviceId) return true;
  const now = Date.now();
  let entry = deviceLimits.get(deviceId);
  if (!entry || now > entry.resetAt) {
    entry = { submissions: /* @__PURE__ */ new Set(), resetAt: now + RATE_LIMIT_WINDOW_MS };
    deviceLimits.set(deviceId, entry);
  }
  if (submissionId && entry.submissions.has(submissionId)) return true;
  if (entry.submissions.size >= RATE_LIMIT_MAX_SUBMISSIONS) {
    return false;
  }
  if (submissionId) entry.submissions.add(submissionId);
  return true;
}
app.post("/api/upload", upload.single("file"), async (req, res) => {
  let optimizedOriginalBuffer;
  let thumbnailBuffer;
  let fileToCleanup;
  try {
    const deviceId = req.headers["x-device-id"];
    if (!checkRateLimit(deviceId)) {
      return res.status(429).json({ error: "Voc\xEA atingiu o limite de 5 envios. Aguarde 10 minutos para enviar novamente." });
    }
    if (!req.file) {
      return res.status(400).json({ error: "No file provided" });
    }
    fileToCleanup = req.file.path;
    if (!s3 || !supabase || !bucketName) {
      return res.status(500).json({ error: "Server storage not configured" });
    }
    const filePath = req.file.path;
    const originalName = req.file.originalname;
    const ext = import_path.default.extname(originalName).toLowerCase();
    if (!req.file.mimetype.startsWith("image/")) {
      return res.status(400).json({ error: "Somente imagens s\xE3o suportadas nesta rota." });
    }
    const uniqueId = (0, import_uuid.v4)();
    const originalFileName = `originals/${uniqueId}_original.webp`;
    const thumbnailFileName = `thumbs/${uniqueId}_thumb.webp`;
    optimizedOriginalBuffer = await sharp(filePath).resize({ width: 1920, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    thumbnailBuffer = await sharp(filePath).resize({ width: 400, height: 400, fit: "cover" }).webp({ quality: 60 }).toBuffer();
    await s3.send(new import_client_s3.PutObjectCommand({
      Bucket: bucketName,
      Key: originalFileName,
      Body: optimizedOriginalBuffer,
      ContentType: "image/webp"
    }));
    await s3.send(new import_client_s3.PutObjectCommand({
      Bucket: bucketName,
      Key: thumbnailFileName,
      Body: thumbnailBuffer,
      ContentType: "image/webp"
    }));
    const originalRelativePath = originalFileName;
    const thumbnailRelativePath = thumbnailFileName;
    const { data, error } = await supabase.from("fotos").insert([
      {
        id: uniqueId,
        url_original: originalRelativePath,
        url_thumbnail: thumbnailRelativePath
      }
    ]).select();
    if (error || !data || data.length === 0) {
      if (error) console.warn("Supabase Insert Warning (Fallback activated):", JSON.stringify(error));
      else console.warn("Supabase Insert Warning: No data returned.");
      const thumbB64 = typeof thumbnailBuffer !== "undefined" ? `data:image/webp;base64,${thumbnailBuffer.toString("base64")}` : "https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&q=80&w=400";
      return res.status(200).json({
        success: true,
        foto: {
          id: uniqueId,
          url_original: thumbB64,
          url_thumbnail: thumbB64,
          data_upload: (/* @__PURE__ */ new Date()).toISOString()
        }
      });
    }
    const responseFoto = {
      ...data[0],
      url_original: `${publicBaseUrl}/${data[0].url_original}`,
      url_thumbnail: `${publicBaseUrl}/${data[0].url_thumbnail}`
    };
    res.status(200).json({ success: true, foto: responseFoto });
  } catch (err) {
    console.error("Upload Route Catch Error:", err);
    res.status(500).json({ error: err.message || "Failed to process photo" });
  } finally {
    if (fileToCleanup && import_fs.default.existsSync(fileToCleanup)) {
      try {
        import_fs.default.unlinkSync(fileToCleanup);
      } catch (e) {
      }
    }
  }
});
app.post("/api/photo/presigned", async (req, res) => {
  try {
    const { deviceId, filename, originalContentType, thumbContentType = "image/webp", submissionId, size } = req.body || {};
    if (!checkRateLimit(deviceId, submissionId)) {
      return res.status(429).json({ error: "Voc\xEA atingiu o limite de 5 envios. Aguarde 10 minutos para enviar novamente." });
    }
    if (!s3 || !bucketName) {
      return res.status(500).json({ error: "Server storage not configured" });
    }
    const uniqueId = (0, import_uuid.v4)();
    let ext = filename ? import_path.default.extname(filename).toLowerCase().replace(".", "") : "jpg";
    if (!ext || ext.length > 5) ext = "jpg";
    const originalFileName = `originals/${uniqueId}_original.${ext}`;
    const thumbnailFileName = `thumbs/${uniqueId}_thumb.webp`;
    const origContentType = originalContentType || (ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg");
    const originalCommand = new import_client_s3.PutObjectCommand({
      Bucket: bucketName,
      Key: originalFileName,
      ContentType: origContentType
    });
    const thumbnailCommand = new import_client_s3.PutObjectCommand({
      Bucket: bucketName,
      Key: thumbnailFileName,
      ContentType: thumbContentType
    });
    const [originalUploadUrl, thumbnailUploadUrl] = await Promise.all([
      (0, import_s3_request_presigner.getSignedUrl)(s3, originalCommand, { expiresIn: 3600 }),
      (0, import_s3_request_presigner.getSignedUrl)(s3, thumbnailCommand, { expiresIn: 3600 })
    ]);
    res.status(200).json({
      id: uniqueId,
      originalUploadUrl,
      thumbnailUploadUrl,
      originalKey: originalFileName,
      thumbnailKey: thumbnailFileName,
      originalContentType: origContentType
    });
  } catch (err) {
    console.error("Photo Presigned URL Error:", err);
    res.status(500).json({ error: err.message || "Failed to generate photo upload URLs" });
  }
});
app.post("/api/photo/finalize", async (req, res) => {
  try {
    const { id, originalKey, thumbnailKey } = req.body || {};
    if (!id || !originalKey || !thumbnailKey) {
      return res.status(400).json({ error: "ID, originalKey e thumbnailKey s\xE3o obrigat\xF3rios" });
    }
    if (!supabase) {
      return res.status(500).json({ error: "Database not configured" });
    }
    const { data, error } = await supabase.from("fotos").insert([
      {
        id,
        url_original: originalKey,
        url_thumbnail: thumbnailKey
      }
    ]).select();
    if (error || !data || data.length === 0) {
      console.warn("Supabase Insert Warning on finalize:", error);
      return res.status(200).json({
        success: true,
        foto: {
          id,
          url_original: `${publicBaseUrl}/${originalKey}`,
          url_thumbnail: `${publicBaseUrl}/${thumbnailKey}`,
          data_upload: (/* @__PURE__ */ new Date()).toISOString()
        }
      });
    }
    const responseFoto = {
      ...data[0],
      url_original: `${publicBaseUrl}/${data[0].url_original}`,
      url_thumbnail: `${publicBaseUrl}/${data[0].url_thumbnail}`
    };
    res.status(200).json({ success: true, foto: responseFoto });
  } catch (err) {
    console.error("Photo Finalize Error:", err);
    res.status(500).json({ error: err.message || "Failed to finalize photo" });
  }
});
app.post("/api/video/presigned", async (req, res) => {
  try {
    const { filename, contentType, deviceId, submissionId, size } = req.body || {};
    if (!checkRateLimit(deviceId, submissionId)) {
      return res.status(429).json({ error: "Voc\xEA atingiu o limite de 5 envios. Aguarde 10 minutos para enviar novamente." });
    }
    if (!contentType || !contentType.startsWith("video/")) {
      return res.status(400).json({ error: "Somente v\xEDdeos s\xE3o permitidos nesta rota." });
    }
    if (size && size > MAX_VIDEO_SIZE) {
      return res.status(400).json({ error: "O v\xEDdeo excede o limite de 150MB." });
    }
    if (!s3 || !bucketName) {
      return res.status(500).json({ error: "Server storage not configured" });
    }
    const uniqueId = (0, import_uuid.v4)();
    const ext = import_path.default.extname(filename) || ".mp4";
    const originalFileName = `originals/${uniqueId}_video${ext}`;
    const thumbnailFileName = `thumbs/${uniqueId}_thumb.webp`;
    const command = new import_client_s3.PutObjectCommand({
      Bucket: bucketName,
      Key: originalFileName,
      ContentType: contentType
    });
    const thumbnailCommand = new import_client_s3.PutObjectCommand({
      Bucket: bucketName,
      Key: thumbnailFileName,
      ContentType: "image/webp"
    });
    const [uploadUrl, thumbnailUploadUrl] = await Promise.all([
      (0, import_s3_request_presigner.getSignedUrl)(s3, command, { expiresIn: 3600 }),
      (0, import_s3_request_presigner.getSignedUrl)(s3, thumbnailCommand, { expiresIn: 3600 })
    ]);
    res.status(200).json({ uploadUrl, key: originalFileName, id: uniqueId, thumbnailUploadUrl, thumbnailKey: thumbnailFileName });
  } catch (err) {
    console.error("Presigned URL Error:", err);
    res.status(500).json({ error: err.message || "Failed to generate upload URL" });
  }
});
app.post("/api/video/finalize", async (req, res) => {
  try {
    const { id, key, thumbnailKey } = req.body;
    if (!id || !key) {
      return res.status(400).json({ error: "ID e Key s\xE3o obrigat\xF3rios" });
    }
    if (!supabase) {
      return res.status(500).json({ error: "Database not configured" });
    }
    const { data, error } = await supabase.from("fotos").insert([
      {
        id,
        url_original: key,
        url_thumbnail: thumbnailKey || key
        // thumbnail is the first-frame image; falls back to original
      }
    ]).select();
    if (error || !data || data.length === 0) {
      return res.status(500).json({ error: "Failed to save video metadata" });
    }
    const responseFoto = {
      ...data[0],
      url_original: `${publicBaseUrl}/${data[0].url_original}`,
      url_thumbnail: `${publicBaseUrl}/${data[0].url_thumbnail}`
    };
    res.status(200).json({ success: true, foto: responseFoto });
  } catch (err) {
    console.error("Video Finalize Error:", err);
    res.status(500).json({ error: err.message || "Failed to finalize video" });
  }
});
app.post("/api/upload/multipart-init", async (req, res) => {
  try {
    const { deviceId, submissionId, filename, contentType, size, kind } = req.body || {};
    if (!checkRateLimit(deviceId, submissionId)) {
      return res.status(429).json({ error: "Voc\xEA atingiu o limite de 5 envios. Aguarde 10 minutos para enviar novamente." });
    }
    if (!s3 || !bucketName) {
      return res.status(500).json({ error: "Server storage not configured" });
    }
    if (!kind || kind !== "photo" && kind !== "video") {
      return res.status(400).json({ error: "kind inv\xE1lido (use 'photo' ou 'video')." });
    }
    if (kind === "video" && size && size > MAX_VIDEO_SIZE) {
      return res.status(400).json({ error: "O v\xEDdeo excede o limite de 150MB." });
    }
    const uniqueId = (0, import_uuid.v4)();
    const rawExt = filename ? import_path.default.extname(filename).toLowerCase().replace(".", "") : kind === "video" ? "mp4" : "jpg";
    const validExt = rawExt && rawExt.length <= 5 ? rawExt : kind === "video" ? "mp4" : "jpg";
    const key = kind === "video" ? `originals/${uniqueId}_video.${validExt}` : `originals/${uniqueId}_original.${validExt}`;
    const command = new import_client_s3.CreateMultipartUploadCommand({
      Bucket: bucketName,
      Key: key,
      ContentType: contentType || (kind === "video" ? "video/mp4" : "image/jpeg")
    });
    const { UploadId: UploadId2 } = await s3.send(command);
    if (!UploadId2) {
      return res.status(500).json({ error: "Falha ao iniciar upload multipart." });
    }
    const totalSize = typeof size === "number" && size > 0 ? size : MULTIPART_CHUNK_SIZE;
    const totalParts = Math.max(1, Math.ceil(totalSize / MULTIPART_CHUNK_SIZE));
    const partUrls = [];
    for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
      const partCommand = new import_client_s3.UploadPartCommand({
        Bucket: bucketName,
        Key: key,
        UploadId: UploadId2,
        PartNumber: partNumber
      });
      const url = await (0, import_s3_request_presigner.getSignedUrl)(s3, partCommand, { expiresIn: 3600 });
      partUrls.push(url);
    }
    const response = {
      id: uniqueId,
      uploadId: UploadId2,
      key,
      partUrls,
      chunkSize: MULTIPART_CHUNK_SIZE,
      totalParts
    };
    const thumbnailKey = `thumbs/${uniqueId}_thumb.webp`;
    const thumbCommand = new import_client_s3.PutObjectCommand({
      Bucket: bucketName,
      Key: thumbnailKey,
      ContentType: "image/webp"
    });
    response.thumbnailUploadUrl = await (0, import_s3_request_presigner.getSignedUrl)(s3, thumbCommand, { expiresIn: 3600 });
    response.thumbnailKey = thumbnailKey;
    res.status(200).json(response);
  } catch (err) {
    console.error("Multipart init error:", err);
    res.status(500).json({ error: err.message || "Falha ao iniciar upload multipart." });
  }
});
app.post("/api/upload/multipart-complete", async (req, res) => {
  try {
    const { id, key, uploadId, parts, kind, thumbnailKey, thumbnailReady } = req.body || {};
    if (!id || !key || !uploadId || !Array.isArray(parts) || parts.length === 0) {
      return res.status(400).json({ error: "Dados incompletos para finalizar o upload." });
    }
    if (!s3 || !bucketName) {
      return res.status(500).json({ error: "Server storage not configured" });
    }
    if (!supabase) {
      return res.status(500).json({ error: "Database not configured" });
    }
    const command = new import_client_s3.CompleteMultipartUploadCommand({
      Bucket: bucketName,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts.map((p) => ({ PartNumber: Number(p.PartNumber), ETag: p.ETag })).sort((a, b) => a.PartNumber - b.PartNumber)
      }
    });
    await s3.send(command);
    const finalThumbnailKey = thumbnailReady === true && thumbnailKey ? thumbnailKey : key;
    const { data, error } = await supabase.from("fotos").insert([{ id, url_original: key, url_thumbnail: finalThumbnailKey }]).select();
    if (error || !data || data.length === 0) {
      console.warn("Supabase insert warning on multipart complete:", error);
      return res.status(200).json({
        success: true,
        foto: {
          id,
          url_original: `${publicBaseUrl}/${key}`,
          url_thumbnail: `${publicBaseUrl}/${finalThumbnailKey}`,
          data_upload: (/* @__PURE__ */ new Date()).toISOString()
        }
      });
    }
    const responseFoto = {
      ...data[0],
      url_original: `${publicBaseUrl}/${data[0].url_original}`,
      url_thumbnail: `${publicBaseUrl}/${data[0].url_thumbnail}`
    };
    res.status(200).json({ success: true, foto: responseFoto });
  } catch (err) {
    console.error("Multipart complete error:", err);
    res.status(500).json({ error: err.message || "Falha ao finalizar upload." });
  }
});
app.post("/api/upload/multipart-abort", async (req, res) => {
  try {
    const { key, uploadId } = req.body || {};
    if (!key || !uploadId) {
      return res.status(400).json({ error: "key e uploadId s\xE3o obrigat\xF3rios." });
    }
    if (!s3 || !bucketName) {
      return res.status(500).json({ error: "Server storage not configured" });
    }
    await s3.send(new import_client_s3.AbortMultipartUploadCommand({ Bucket: bucketName, Key: key, UploadId }));
    res.status(200).json({ success: true });
  } catch (err) {
    console.error("Multipart abort error:", err);
    res.status(500).json({ error: err.message || "Falha ao abortar upload." });
  }
});
app.post("/api/upload/set-thumbnail", async (req, res) => {
  try {
    const { id, thumbnailKey } = req.body || {};
    if (!id || !thumbnailKey) {
      return res.status(400).json({ error: "id e thumbnailKey s\xE3o obrigat\xF3rios." });
    }
    if (!supabase) {
      return res.status(500).json({ error: "Database not configured" });
    }
    const { error } = await supabase.from("fotos").update({ url_thumbnail: thumbnailKey }).eq("id", id);
    if (error) {
      console.error("set-thumbnail error:", error);
      return res.status(500).json({ error: error.message || "Falha ao atualizar miniatura." });
    }
    res.status(200).json({ success: true });
  } catch (err) {
    console.error("set-thumbnail error:", err);
    res.status(500).json({ error: err.message || "Falha ao atualizar miniatura." });
  }
});
app.get("/api/photos", async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({ error: "Database not configured" });
    }
    if (req.query.clear === "true") {
      await supabase.from("fotos").delete().eq("id", "dd0a4446-f859-4ea7-afee-c603aeb3840e");
      await supabase.from("fotos").delete().eq("id", "e7756ac4-47d6-4561-bed6-3a0c7ad5804d");
    }
    let { data, error } = await supabase.from("fotos").select("*").order("data_upload", { ascending: false });
    if (error) {
      console.error("Fetch photos error:", error);
      return res.status(200).json([]);
    }
    if (!data) data = [];
    const deletedIds = new Set(
      data.filter((foto) => foto.url_original?.startsWith("DELETED_")).map((foto) => foto.url_original.replace("DELETED_", ""))
    );
    data = data.filter(
      (foto) => !foto.url_original?.startsWith("DELETED_") && !deletedIds.has(foto.id)
    );
    const hasCover = data.some((f) => f.url_original && f.url_original.includes("RafaeDani.webp"));
    if (!hasCover && supabase) {
      const coverId = "rafae-dani-cover-id-001";
      const coverRecord = {
        id: coverId,
        url_original: "RafaeDani.webp",
        url_thumbnail: "RafaeDani.webp",
        data_upload: (/* @__PURE__ */ new Date()).toISOString()
      };
      try {
        await supabase.from("fotos").upsert([coverRecord], { onConflict: "id" });
      } catch (e) {
        console.warn("Could not upsert cover photo");
      }
      data.unshift(coverRecord);
    }
    const processedData = data.map((foto) => {
      const isAbsoluteOriginal = foto.url_original?.startsWith("http");
      const isAbsoluteThumbnail = foto.url_thumbnail?.startsWith("http");
      let orig = isAbsoluteOriginal ? foto.url_original : `${publicBaseUrl}/${foto.url_original}`;
      let thumb = isAbsoluteThumbnail ? foto.url_thumbnail : `${publicBaseUrl}/${foto.url_thumbnail}`;
      if (foto.url_original === "RafaeDani.webp") {
        orig = `${publicBaseUrl}/RafaeDani.webp`;
        thumb = `${publicBaseUrl}/RafaeDani.webp`;
      }
      return {
        ...foto,
        url_original: orig,
        url_thumbnail: thumb
      };
    });
    res.status(200).json(processedData);
  } catch (err) {
    console.error("Error in /api/photos:", err);
    return res.status(200).json([]);
  }
});
var checkAdmin = (req, res, next) => {
  const pwd = req.headers["x-admin-password"];
  if (pwd !== "admin123") {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
};
app.post("/api/admin/set-cover", upload.single("file"), checkAdmin, async (req, res) => {
  let fileToCleanup;
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file provided" });
    }
    fileToCleanup = req.file.path;
    if (!s3 || !bucketName) {
      return res.status(500).json({ error: "Server storage not configured" });
    }
    const fileBuffer = import_fs.default.readFileSync(req.file.path);
    const coverFileName = "RafaeDani.webp";
    const optimizedCover = await sharp(fileBuffer).resize({ width: 1920, withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
    await s3.send(new import_client_s3.PutObjectCommand({
      Bucket: bucketName,
      Key: coverFileName,
      Body: optimizedCover,
      ContentType: "image/webp"
    }));
    res.status(200).json({ success: true, url: `${publicBaseUrl}/RafaeDani.webp?t=${Date.now()}` });
  } catch (err) {
    console.error("Set cover error:", err);
    res.status(500).json({ error: "Failed to set cover photo", details: err.message });
  } finally {
    if (fileToCleanup && import_fs.default.existsSync(fileToCleanup)) {
      try {
        import_fs.default.unlinkSync(fileToCleanup);
      } catch (e) {
      }
    }
  }
});
app.delete("/api/admin/photos/:id", checkAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !supabase || !s3 || !bucketName) {
      return res.status(400).json({ error: "Invalid request or storage not configured" });
    }
    const { data: fotos, error: fetchError } = await supabase.from("fotos").select("*").eq("id", id);
    if (fetchError || !fotos || fotos.length === 0) {
      return res.status(404).json({ error: "Photo not found" });
    }
    const foto = fotos[0];
    const { error: deleteError } = await supabase.from("fotos").delete().eq("id", id);
    if (deleteError) {
      console.warn("Delete error (might be expected if RLS is active):", deleteError);
    }
    try {
      await supabase.from("fotos").insert([
        {
          id: (0, import_uuid.v4)(),
          url_original: "DELETED_" + id,
          url_thumbnail: "DELETED"
        }
      ]);
    } catch (e) {
      console.warn("Could not insert marker row", e);
    }
    try {
      if (foto.url_original && !foto.url_original.startsWith("http")) {
        await s3.send(new import_client_s3.DeleteObjectCommand({
          Bucket: bucketName,
          Key: foto.url_original
        }));
      }
      if (foto.url_thumbnail && !foto.url_thumbnail.startsWith("http")) {
        await s3.send(new import_client_s3.DeleteObjectCommand({
          Bucket: bucketName,
          Key: foto.url_thumbnail
        }));
      }
    } catch (minioErr) {
      console.warn("Could not delete from MinIO:", minioErr);
    }
    res.status(200).json({ success: true });
  } catch (err) {
    console.error("Delete photo error:", err);
    res.status(500).json({ error: "Failed to delete photo", details: err.message });
  }
});
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const resolveDistPath = () => {
      let dir = __dirname;
      for (let i = 0; i < 8; i++) {
        for (const cand of ["dist", "public", "public_html", ""]) {
          const p = import_path.default.join(dir, cand);
          if (import_fs.default.existsSync(import_path.default.join(p, "index.html"))) return p;
        }
        const parent = import_path.default.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
      return import_path.default.join(process.cwd(), "dist");
    };
    const distPath = resolveDistPath();
    console.log("Serving static production files from:", distPath);
    app.use(import_express.default.static(distPath));
    app.get("*", (req, res) => {
      const indexPath = import_path.default.join(distPath, "index.html");
      if (import_fs.default.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send("index.html not found. Please run 'npm run build'.");
      }
    });
  }
  const listenPort = process.env.PORT || 3e3;
  if (typeof listenPort === "string" && isNaN(Number(listenPort))) {
    app.listen(listenPort, () => {
      console.log(`Server running on pipe/socket ${listenPort}`);
    });
  } else {
    app.listen(Number(listenPort) || 3e3, "0.0.0.0", () => {
      console.log(`Server running on port ${listenPort}`);
    });
  }
}
startServer();
//# sourceMappingURL=server.cjs.map
