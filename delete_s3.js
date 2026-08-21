import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
const s3 = new S3Client({
  region: "auto",
  endpoint: "https://s3.danierafa.online:443",
  credentials: { accessKeyId: "SUHDHS8PL583G8G2ULFF", secretAccessKey: "vawGVB5fZdNDdVWbrKP+63EkQnLphJqsjtygb+6r" },
  forcePathStyle: true,
});
s3.send(new DeleteObjectCommand({ Bucket: "rafa-dani", Key: "RafaeDani.webp" })).then(() => console.log("Deleted")).catch(console.error);
