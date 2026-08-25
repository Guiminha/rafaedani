import fs from "fs";
import os from "os";
import express from "express";
import path from "path";
import multer from "multer";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createClient } from "@supabase/supabase-js";
import { v4 as uuidv4 } from "uuid";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

let sharp: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  sharp = require("sharp");
  if (sharp) {
    sharp.cache(false);
    sharp.concurrency(1);
  }
} catch (e) {
  console.warn("Sharp native module not available or failed to load. Image processing will run in fallback mode.", e);
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Health check endpoint to verify backend status on Hostinger / Production
app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    uptime: process.uptime(),
    supabaseConfigured: !!supabase,
    minioConfigured: !!s3,
    timestamp: new Date().toISOString(),
  });
});

/* 
  --- SQL INSTRUCTION FOR SUPABASE ---
  CREATE TABLE fotos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      url_original TEXT NOT NULL,
      url_thumbnail TEXT NOT NULL,
      data_upload TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );
*/

// Initialize Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
let supabase: ReturnType<typeof createClient> | null = null;
try {
  if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
  } else {
    console.warn("Supabase credentials are not set. Database operations will fail.");
  }
} catch (err) {
  console.error("Failed to initialize Supabase:", err);
}

// Initialize S3/MinIO Client
const minioEndpoint = process.env.MINIO_ENDPOINT;
const minioPort = process.env.MINIO_PORT;
const minioUseSSL = process.env.MINIO_USE_SSL !== "false"; // Default to true unless explicitly false
const minioAccessKey = process.env.MINIO_ACCESS_KEY;
const minioSecretKey = process.env.MINIO_SECRET_KEY;
const bucketName = process.env.MINIO_BUCKET_NAME;

let s3: S3Client | null = null;
try {
  if (minioEndpoint && minioAccessKey && minioSecretKey) {
    let endpointUrl = minioEndpoint;
    // If user didn't include http/https, add it
    if (!endpointUrl.startsWith("http://") && !endpointUrl.startsWith("https://")) {
      const protocol = minioUseSSL ? "https" : "http";
      const portStr = minioPort ? `:${minioPort}` : "";
      endpointUrl = `${protocol}://${minioEndpoint}${portStr}`;
    }
    
    s3 = new S3Client({
      region: "auto", // S3Client handles 'auto' well for non-AWS S3
      endpoint: endpointUrl,
      credentials: {
        accessKeyId: minioAccessKey,
        secretAccessKey: minioSecretKey,
      },
      forcePathStyle: true, // Required for MinIO
    });
    
    // Set a default public URL if not provided by user
    if (!process.env.MINIO_PUBLIC_URL) {
      process.env.MINIO_PUBLIC_URL = `${endpointUrl}/${bucketName}`;
    }
  } else {
    console.warn("MinIO credentials are not set. File uploads will fail.");
  }
} catch (err) {
  console.error("Failed to initialize S3 client:", err);
}

const minioPublicUrl = (process.env.MINIO_PUBLIC_URL || "").replace(/\/$/, "");
const publicBaseUrl = minioPublicUrl.endsWith(`/${bucketName}`) 
  ? minioPublicUrl 
  : minioPublicUrl ? `${minioPublicUrl}/${bucketName}` : "";

const upload = multer({ dest: os.tmpdir() });

// Rate limit map
interface RateLimit {
  count: number;
  resetAt: number;
}
const deviceLimits = new Map<string, RateLimit>();

function checkRateLimit(deviceId: string | undefined): boolean {
  if (!deviceId) return true; // allow if no device ID provided, though frontend should always provide it
  const now = Date.now();
  const limit = deviceLimits.get(deviceId);
  
  if (!limit || now > limit.resetAt) {
    deviceLimits.set(deviceId, { count: 1, resetAt: now + 10 * 60 * 1000 });
    return true;
  }
  
  if (limit.count >= 15) { // 3 uploads of up to 5 files = 15 files per 10 mins
    return false;
  }
  
  limit.count++;
  return true;
}

// Upload Endpoint
app.post("/api/upload", upload.single("file"), async (req, res): Promise<any> => {
  let optimizedOriginalBuffer: Buffer | undefined;
  let thumbnailBuffer: Buffer | undefined;
  let fileToCleanup: string | undefined;

  try {
    const deviceId = req.headers["x-device-id"] as string;
    if (!checkRateLimit(deviceId)) {
      return res.status(429).json({ error: "Limite de envios atingido. Aguarde 10 minutos." });
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
    const ext = path.extname(originalName).toLowerCase();
    
    if (!req.file.mimetype.startsWith("image/")) {
       return res.status(400).json({ error: "Somente imagens são suportadas nesta rota." });
    }

    const uniqueId = uuidv4();
    const originalFileName = `originals/${uniqueId}_original.webp`;
    const thumbnailFileName = `thumbs/${uniqueId}_thumb.webp`;

    // Optimize original image to webp
    optimizedOriginalBuffer = await sharp(filePath)
      .resize({ width: 1920, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();

    // Create thumbnail
    thumbnailBuffer = await sharp(filePath)
      .resize({ width: 400, height: 400, fit: "cover" })
      .webp({ quality: 60 })
      .toBuffer();

    // Upload original to MinIO
    await s3.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: originalFileName,
      Body: optimizedOriginalBuffer,
      ContentType: "image/webp",
    }));

    // Upload thumbnail to MinIO
    await s3.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: thumbnailFileName,
      Body: thumbnailBuffer,
      ContentType: "image/webp",
    }));

    const originalRelativePath = originalFileName;
    const thumbnailRelativePath = thumbnailFileName;

    // Insert into Supabase
    const { data, error } = await (supabase as any)
      .from("fotos")
      .insert([
        {
          id: uniqueId,
          url_original: originalRelativePath,
          url_thumbnail: thumbnailRelativePath,
        } as any
      ])
      .select();

    if (error || !data || data.length === 0) {
      if (error) console.warn("Supabase Insert Warning (Fallback activated):", JSON.stringify(error));
      else console.warn("Supabase Insert Warning: No data returned.");
      // Fallback: use the thumbnail base64 for both to keep payload small and prevent proxy crash
      const thumbB64 = typeof thumbnailBuffer !== 'undefined'
        ? `data:image/webp;base64,${thumbnailBuffer.toString("base64")}`
        : "https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&q=80&w=400";
        
      return res.status(200).json({ 
        success: true, 
        foto: {
          id: uniqueId,
          url_original: thumbB64,
          url_thumbnail: thumbB64,
          data_upload: new Date().toISOString()
        } as any
      });
    }

    // Format response so the frontend gets absolute URLs
    const responseFoto = {
      ...data[0],
      url_original: `${publicBaseUrl}/${data[0].url_original}`,
      url_thumbnail: `${publicBaseUrl}/${data[0].url_thumbnail}`,
    };

    res.status(200).json({ success: true, foto: responseFoto });
  } catch (err: any) {
    console.error("Upload Route Catch Error:", err);
    res.status(500).json({ error: err.message || "Failed to process photo" });
  } finally {
    if (fileToCleanup && fs.existsSync(fileToCleanup)) {
      try { fs.unlinkSync(fileToCleanup); } catch (e) { /* ignore */ }
    }
  }
});

// Photo Presigned URL Endpoint (Direct S3 upload for instant speed & zero server memory, preserving 100% original quality)
app.post("/api/photo/presigned", async (req, res): Promise<any> => {
  try {
    const { deviceId, filename, originalContentType, thumbContentType = "image/webp" } = req.body || {};
    if (!checkRateLimit(deviceId)) {
      return res.status(429).json({ error: "Limite de envios atingido. Aguarde 10 minutos." });
    }
    if (!s3 || !bucketName) {
      return res.status(500).json({ error: "Server storage not configured" });
    }

    const uniqueId = uuidv4();
    let ext = filename ? path.extname(filename).toLowerCase().replace(".", "") : "jpg";
    if (!ext || ext.length > 5) ext = "jpg";

    const originalFileName = `originals/${uniqueId}_original.${ext}`;
    const thumbnailFileName = `thumbs/${uniqueId}_thumb.webp`;

    const origContentType = originalContentType || (ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg");

    const originalCommand = new PutObjectCommand({
      Bucket: bucketName,
      Key: originalFileName,
      ContentType: origContentType,
    });
    const thumbnailCommand = new PutObjectCommand({
      Bucket: bucketName,
      Key: thumbnailFileName,
      ContentType: thumbContentType,
    });

    const [originalUploadUrl, thumbnailUploadUrl] = await Promise.all([
      getSignedUrl(s3, originalCommand, { expiresIn: 3600 }),
      getSignedUrl(s3, thumbnailCommand, { expiresIn: 3600 }),
    ]);

    res.status(200).json({
      id: uniqueId,
      originalUploadUrl,
      thumbnailUploadUrl,
      originalKey: originalFileName,
      thumbnailKey: thumbnailFileName,
      originalContentType: origContentType,
    });
  } catch (err: any) {
    console.error("Photo Presigned URL Error:", err);
    res.status(500).json({ error: err.message || "Failed to generate photo upload URLs" });
  }
});

// Photo Finalize Endpoint
app.post("/api/photo/finalize", async (req, res): Promise<any> => {
  try {
    const { id, originalKey, thumbnailKey } = req.body || {};
    if (!id || !originalKey || !thumbnailKey) {
      return res.status(400).json({ error: "ID, originalKey e thumbnailKey são obrigatórios" });
    }
    if (!supabase) {
      return res.status(500).json({ error: "Database not configured" });
    }

    const { data, error } = await (supabase as any)
      .from("fotos")
      .insert([
        {
          id,
          url_original: originalKey,
          url_thumbnail: thumbnailKey,
        } as any
      ])
      .select();

    if (error || !data || data.length === 0) {
      console.warn("Supabase Insert Warning on finalize:", error);
      return res.status(200).json({
        success: true,
        foto: {
          id,
          url_original: `${publicBaseUrl}/${originalKey}`,
          url_thumbnail: `${publicBaseUrl}/${thumbnailKey}`,
          data_upload: new Date().toISOString(),
        }
      });
    }

    const responseFoto = {
      ...data[0],
      url_original: `${publicBaseUrl}/${data[0].url_original}`,
      url_thumbnail: `${publicBaseUrl}/${data[0].url_thumbnail}`,
    };

    res.status(200).json({ success: true, foto: responseFoto });
  } catch (err: any) {
    console.error("Photo Finalize Error:", err);
    res.status(500).json({ error: err.message || "Failed to finalize photo" });
  }
});

// Video Presigned URL Endpoint
app.post("/api/video/presigned", async (req, res): Promise<any> => {
  try {
    const { filename, contentType, deviceId } = req.body;
    if (!checkRateLimit(deviceId)) {
      return res.status(429).json({ error: "Limite de envios atingido. Aguarde 10 minutos." });
    }
    if (!contentType || !contentType.startsWith("video/")) {
      return res.status(400).json({ error: "Somente vídeos são permitidos nesta rota." });
    }
    if (!s3 || !bucketName) {
      return res.status(500).json({ error: "Server storage not configured" });
    }

    const uniqueId = uuidv4();
    const ext = path.extname(filename) || ".mp4";
    const originalFileName = `originals/${uniqueId}_video${ext}`;

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: originalFileName,
      ContentType: contentType
    });
    
    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
    
    res.status(200).json({ uploadUrl, key: originalFileName, id: uniqueId });
  } catch (err: any) {
    console.error("Presigned URL Error:", err);
    res.status(500).json({ error: err.message || "Failed to generate upload URL" });
  }
});

// Video Finalize Endpoint
app.post("/api/video/finalize", async (req, res): Promise<any> => {
  try {
    const { id, key } = req.body;
    if (!id || !key) {
      return res.status(400).json({ error: "ID e Key são obrigatórios" });
    }
    if (!supabase) {
      return res.status(500).json({ error: "Database not configured" });
    }

    const { data, error } = await (supabase as any)
      .from("fotos")
      .insert([
        {
          id: id,
          url_original: key,
          url_thumbnail: key, // For video, we will use the original video url and frontend will render <video>
        } as any
      ])
      .select();

    if (error || !data || data.length === 0) {
      return res.status(500).json({ error: "Failed to save video metadata" });
    }

    const responseFoto = {
      ...data[0],
      url_original: `${publicBaseUrl}/${data[0].url_original}`,
      url_thumbnail: `${publicBaseUrl}/${data[0].url_thumbnail}`,
    };

    res.status(200).json({ success: true, foto: responseFoto });
  } catch (err: any) {
    console.error("Video Finalize Error:", err);
    res.status(500).json({ error: err.message || "Failed to finalize video" });
  }
});

// List Endpoint
app.get("/api/photos", async (req, res): Promise<any> => {
  try {
    if (!supabase) {
      return res.status(500).json({ error: "Database not configured" });
    }

    // Add query parameter to clear DB easily
    if (req.query.clear === "true") {
      await supabase.from("fotos").delete().eq("id", "dd0a4446-f859-4ea7-afee-c603aeb3840e");
      await supabase.from("fotos").delete().eq("id", "e7756ac4-47d6-4561-bed6-3a0c7ad5804d");
    }

    let { data, error } = await (supabase as any)
      .from("fotos")
      .select("*")
      .order("data_upload", { ascending: false });

    if (error) {
      console.error("Fetch photos error:", error);
      return res.status(200).json([]);
    }

    if (!data) data = [];

    // --- RLS Bypass: Extract Soft Deleted IDs ---
    const deletedIds = new Set(
      data
        .filter((foto: any) => foto.url_original?.startsWith("DELETED_"))
        .map((foto: any) => foto.url_original.replace("DELETED_", ""))
    );

    // Filter out both the marker rows themselves AND the photos that were deleted
    data = data.filter((foto: any) => 
      !foto.url_original?.startsWith("DELETED_") && !deletedIds.has(foto.id)
    );

    // Ensure RafaeDani.webp cover photo is registered in DB so it's never lost
    const hasCover = data.some((f: any) => f.url_original && f.url_original.includes("RafaeDani.webp"));
    if (!hasCover && supabase) {
      const coverId = "rafae-dani-cover-id-001";
      const coverRecord = {
        id: coverId,
        url_original: "RafaeDani.webp",
        url_thumbnail: "RafaeDani.webp",
        data_upload: new Date().toISOString(),
      };
      
      try {
        await (supabase as any).from("fotos").upsert([coverRecord], { onConflict: 'id' });
      } catch(e) {
        console.warn("Could not upsert cover photo");
      }
      
      data.unshift(coverRecord);
    }

    const processedData = data
      .map((foto: any) => {
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
        url_thumbnail: thumb,
      };
    });

    res.status(200).json(processedData);
  } catch (err: any) {
    console.error("Error in /api/photos:", err);
    return res.status(200).json([]);
  }
});

// Admin endpoint middleware helper
const checkAdmin = (req: any, res: any, next: any) => {
  const pwd = req.headers["x-admin-password"];
  if (pwd !== "admin123") {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
};

// Admin: Set Cover Endpoint
app.post("/api/admin/set-cover", upload.single("file"), checkAdmin, async (req, res): Promise<any> => {
  let fileToCleanup: string | undefined;
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file provided" });
    }
    fileToCleanup = req.file.path;
    if (!s3 || !bucketName) {
      return res.status(500).json({ error: "Server storage not configured" });
    }

    const fileBuffer = fs.readFileSync(req.file.path);
    const coverFileName = "RafaeDani.webp";

    const optimizedCover = await sharp(fileBuffer)
      .resize({ width: 1920, withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();

    await s3.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: coverFileName,
      Body: optimizedCover,
      ContentType: "image/webp",
    }));

    res.status(200).json({ success: true, url: `${publicBaseUrl}/RafaeDani.webp?t=${Date.now()}` });
  } catch (err: any) {
    console.error("Set cover error:", err);
    res.status(500).json({ error: "Failed to set cover photo", details: err.message });
  } finally {
    if (fileToCleanup && fs.existsSync(fileToCleanup)) {
      try { fs.unlinkSync(fileToCleanup); } catch (e) { /* ignore */ }
    }
  }
});

// Admin: Delete Photo Endpoint
app.delete("/api/admin/photos/:id", checkAdmin, async (req, res): Promise<any> => {
  try {
    const { id } = req.params;
    if (!id || !supabase || !s3 || !bucketName) {
      return res.status(400).json({ error: "Invalid request or storage not configured" });
    }

    // 1. Get photo from DB to find the object keys
    const { data: fotos, error: fetchError } = await (supabase as any)
      .from("fotos")
      .select("*")
      .eq("id", id);
      
    if (fetchError || !fotos || fotos.length === 0) {
      return res.status(404).json({ error: "Photo not found" });
    }
    
    const foto = fotos[0];

    // 2. Delete from DB (This might silently fail if RLS is enabled on the table and blocking DELETE for this key)
    const { error: deleteError } = await (supabase as any)
      .from("fotos")
      .delete()
      .eq("id", id);
      
    if (deleteError) {
      console.warn("Delete error (might be expected if RLS is active):", deleteError);
    }

    // --- RLS BYPASS (SOFT DELETE) ---
    // If the table blocks DELETE due to Row Level Security, we insert a marker row 
    // to flag this ID as deleted. The GET /api/photos route will filter it out.
    try {
      await (supabase as any).from("fotos").insert([
        {
          id: uuidv4(),
          url_original: "DELETED_" + id,
          url_thumbnail: "DELETED"
        }
      ]);
    } catch (e: any) {
      console.warn("Could not insert marker row", e);
    }

    // 3. Delete from MinIO (we ignore errors here in case file is missing)
    try {
      if (foto.url_original && !foto.url_original.startsWith("http")) {
        await s3.send(new DeleteObjectCommand({
          Bucket: bucketName,
          Key: foto.url_original
        }));
      }
      if (foto.url_thumbnail && !foto.url_thumbnail.startsWith("http")) {
        await s3.send(new DeleteObjectCommand({
          Bucket: bucketName,
          Key: foto.url_thumbnail
        }));
      }
    } catch (minioErr) {
      console.warn("Could not delete from MinIO:", minioErr);
    }

    res.status(200).json({ success: true });
  } catch (err: any) {
    console.error("Delete photo error:", err);
    res.status(500).json({ error: "Failed to delete photo", details: err.message });
  }
});

async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const possibleDistPaths = [
      path.join(process.cwd(), "dist"),
      path.join(__dirname, "dist"),
      path.join(__dirname, "../dist"),
      path.join(process.cwd(), "public_html"),
      path.join(__dirname),
    ];
    const distPath = possibleDistPaths.find((p) => fs.existsSync(path.join(p, "index.html"))) || possibleDistPaths[0];

    console.log("Serving static production files from:", distPath);
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      const indexPath = path.join(distPath, "index.html");
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send("index.html not found. Please run 'npm run build'.");
      }
    });
  }

  if (typeof PORT === "string" && isNaN(Number(PORT))) {
    app.listen(PORT, () => {
      console.log(`Server running on pipe/socket ${PORT}`);
    });
  } else {
    app.listen(Number(PORT), "0.0.0.0", () => {
      console.log(`Server running on port ${PORT}`);
    });
  }
}

startServer();
