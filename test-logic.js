import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const publicBaseUrl = "https://s3.danierafa.online";

async function test() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  let { data, error } = await supabase.from('fotos').select('*').order('data_upload', { ascending: false });
  
  if (error) {
    console.error("DB Error:", error);
    return;
  }
  
  try {
    if (!data) data = [];

    const hasCover = data.some((f) => f.url_original && f.url_original.includes("RafaeDani.webp"));
    if (!hasCover) {
      const coverRecord = {
        id: "rafae-dani-cover-id-001",
        url_original: "RafaeDani.webp",
        url_thumbnail: "RafaeDani.webp",
        data_upload: new Date("2026-08-21T15:00:00.000Z").toISOString(),
      };
      data.unshift(coverRecord);
    }

    const currentAppVersionStartDate = new Date("2026-08-21T14:40:00.000Z");

    const processedData = data
      .filter((foto) => foto.url_original?.includes("RafaeDani.webp") || new Date(foto.data_upload) > currentAppVersionStartDate)
      .map((foto) => {
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
      
    console.log("Processed Data Count:", processedData.length);
  } catch(err) {
    console.error("Caught error:", err);
  }
}
test();
