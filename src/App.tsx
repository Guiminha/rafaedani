/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { Camera, X, Upload, CheckCircle2, AlertCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { Foto } from "./types";
import { uploadPhotoDirect } from "./uploader";

const getDeviceId = () => {
  let id = localStorage.getItem("deviceId");
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
    localStorage.setItem("deviceId", id);
  }
  return id;
};

const isVideoFile = (f: File): boolean =>
  (f.type && f.type.startsWith("video/")) ||
  /\.(mp4|mov|webm|m4v|mkv|avi|mpg|mpeg|wmv|flv|3gp|ogv)$/i.test(f.name);

export default function App() {
  const [photos, setPhotos] = useState<Foto[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "success" | "error">("idle");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [overallProgress, setOverallProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");

  // Lightbox state
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Transient toast (auto-dismiss)
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const showToast = (msg: string) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = window.setTimeout(() => setToast(null), 1500);
  };

  useEffect(() => {
    fetchPhotos();
  }, []);

  const fetchPhotos = async () => {
    try {
      const res = await fetch("/api/photos");
      if (res.ok) {
        const data = await res.json();
        setPhotos(data);
      }
    } catch (err) {
      console.error("Error fetching photos", err);
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Reset the input value so the same selection can be picked again later
    const inputEl = e.target;
    if (!e.target.files || e.target.files.length === 0) {
      inputEl.value = "";
      return;
    }
    // Only accept photos (ignore any video files that sneak in).
    const incoming = Array.from(e.target.files).filter((f) => !isVideoFile(f));
    if (incoming.length === 0) {
      inputEl.value = "";
      return;
    }
    setSelectedFiles([...selectedFiles, ...incoming]);
    setUploadStatus("idle");
    setOverallProgress(0);
    inputEl.value = "";
  };

  const handleUpload = async () => {
    if (selectedFiles.length === 0) return;
    
    setUploading(true);
    setUploadStatus("idle");
    setOverallProgress(0);
    setErrorMessage("");
    
    const newPhotos: Foto[] = [];
    const deviceId = getDeviceId();
    const submissionId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);

    try {
      // Photos only: upload the first 10 selected images (videos are ignored).
      const filesToUpload = selectedFiles.filter((f) => !isVideoFile(f)).slice(0, 10);

      const totalFiles = filesToUpload.length;
      for (let i = 0; i < totalFiles; i++) {
        const file = filesToUpload[i];

        const updateProgress = (filePct: number) => {
          const completedPortion = (i / totalFiles) * 100;
          const currentFilePortion = (filePct / 100) * (100 / totalFiles);
          setOverallProgress(Math.min(99, Math.round(completedPortion + currentFilePortion)));
        };

        // Photo upload: 100% untouched original resolution & bit-for-bit quality
        const foto = await uploadPhotoDirect(file, deviceId, updateProgress, submissionId);
        newPhotos.push(foto);
      }

      setOverallProgress(100);
      setUploadStatus("success");
      setSelectedFiles([]);
      // Add new photos to the beginning of the list
      setPhotos((prev) => [...newPhotos.reverse(), ...prev]);

      // Auto-close the upload screen right after finishing, returning the user
      // to the home gallery where the new photos are already displayed.
      setIsModalOpen(false);
      setUploading(false);
      setUploadStatus("idle");
    } catch (err: any) {
      console.error("Upload failed", err);
      setUploadStatus("error");
      setErrorMessage(err.message || "Erro desconhecido ao realizar upload.");
    } finally {
      setUploading(false);
    }
  };

  const coverPhoto = photos.find(p => p.url_original.includes("RafaeDani.webp"));
  const coverImageUrl = coverPhoto ? coverPhoto.url_original : "https://s3.danierafa.online/rafa-dani/RafaeDani.webp";
  const galleryPhotos = photos.filter(p => !p.url_original.includes("RafaeDani.webp"));

  const openLightbox = (index: number) => setLightboxIndex(index);
  const closeLightbox = () => setLightboxIndex(null);
  
  const showPrevPhoto = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (lightboxIndex !== null) {
      setLightboxIndex(lightboxIndex === 0 ? galleryPhotos.length - 1 : lightboxIndex - 1);
    }
  };

  const showNextPhoto = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (lightboxIndex !== null) {
      setLightboxIndex(lightboxIndex === galleryPhotos.length - 1 ? 0 : lightboxIndex + 1);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-neutral-900 font-sans text-neutral-100 relative overflow-x-hidden">
      {/* Background Gradient */}
      <div className="fixed bottom-0 right-0 w-[60vw] h-[50vh] bg-gradient-to-tl from-[#3CA0CC]/10 via-[#3CA0CC]/5 to-transparent blur-[80px] pointer-events-none z-0"></div>

      {/* Header (Capa) */}
      <header className="relative h-64 sm:h-80 w-full bg-neutral-800 shrink-0">
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent z-10"></div>
        <img 
          src={coverImageUrl} 
          alt="Capa do Casamento" 
          className="absolute inset-0 w-full h-full object-cover object-top z-0"
          decoding="async"
        />
        <div className="absolute inset-0 z-20 flex items-end justify-center text-white drop-shadow-lg pb-6 sm:pb-8">
          <div className="flex flex-col items-center">
            <h1 
              className="text-5xl sm:text-7xl md:text-8xl font-normal text-center drop-shadow-xl"
              style={{ fontFamily: "'Great Vibes', cursive" }}
            >
              Danielle
              <span className="inline-block mx-2 sm:mx-4 md:mx-6 text-[#3CA0CC] font-normal text-4xl sm:text-6xl md:text-7xl">&amp;</span>
              Rafael
            </h1>
            <div className="h-[1px] w-32 bg-gradient-to-r from-transparent via-[#3CA0CC] to-transparent mt-2 mb-2"></div>
            <p className="text-xs sm:text-sm font-medium tracking-[0.3em] uppercase opacity-90 mt-1">06 • 09 • 2026</p>
          </div>
        </div>
      </header>

      {/* Seção de Título */}
      <main className="flex-1 flex flex-col max-w-5xl mx-auto w-full relative z-10">
        <section className="px-6 py-8 shrink-0 text-center">
          <h2 className="text-xl sm:text-2xl font-light text-white leading-tight">
            Compartilhe seus momentos<br />com a gente!
          </h2>
        </section>

        {/* Galeria de Fotos */}
        <section className="px-4 flex-1 pb-24">
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-[#3CA0CC]"></div>
          </div>
        ) : galleryPhotos.length === 0 ? (
          <div className="text-center py-20 bg-neutral-900/50 rounded-xl border border-neutral-800 backdrop-blur-sm">
            <Camera className="w-12 h-12 text-neutral-600 mx-auto mb-3" />
            <p className="text-neutral-400 text-sm">Nenhuma foto ainda. Seja o primeiro a compartilhar!</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 content-start h-full">
            {galleryPhotos.map((foto, index) => (
              <div 
                key={foto.id} 
                className="aspect-square relative overflow-hidden bg-neutral-800 cursor-pointer group rounded-lg ring-1 ring-white/5"
                onClick={() => openLightbox(index)}
              >
                {foto.url_thumbnail && /\.(webp|jpe?g|png|gif)$/i.test(foto.url_thumbnail) ? (
                  <>
                    <img
                      src={foto.url_thumbnail}
                      alt="Momento do casamento"
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      loading="lazy"
                      decoding="async"
                      onError={(e) => {
                        const target = e.currentTarget;
                        target.style.display = 'none';
                        target.parentElement?.classList.add('flex', 'items-center', 'justify-center');
                        target.parentElement?.setAttribute('title', 'Imagem bloqueada pelo MinIO (Bucket não é público)');
                        const errorIcon = document.createElement('div');
                        errorIcon.className = 'text-xs text-center text-neutral-500 p-2';
                        errorIcon.innerHTML = '🔒<br/>Privado';
                        target.parentElement?.appendChild(errorIcon);
                      }}
                    />
                  </>
                ) : (
                  <>
                    <video
                      src={foto.url_original}
                      preload="metadata"
                      muted
                      playsInline
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105 pointer-events-none"
                    />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/40 transition-colors duration-300">
                      <div className="w-10 h-10 rounded-full bg-black/50 flex items-center justify-center backdrop-blur-sm shadow-xl">
                        <div className="w-0 h-0 border-y-[6px] border-y-transparent border-l-[10px] border-l-white ml-1"></div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
        </section>
      </main>

      {/* Footer / Barra Fixa */}
      <footer className="fixed bottom-0 left-0 right-0 p-4 bg-[#0a0a0a]/80 backdrop-blur-xl border-t border-white/5 flex items-center justify-center z-40">
        <div className="w-full max-w-md mx-auto">
          <button 
            onClick={() => {
              setIsModalOpen(true);
              setUploadStatus("idle");
              setSelectedFiles([]);
            }}
            className="w-full h-14 bg-[#3CA0CC] hover:bg-[#348db4] text-white font-bold rounded-2xl shadow-lg shadow-[#3CA0CC]/30 active:scale-95 transition-all text-lg flex items-center justify-center gap-2"
          >
            <Upload className="w-5 h-5" />
            Enviar Foto
          </button>
        </div>
      </footer>

      {/* Modal de Upload */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => !uploading && setIsModalOpen(false)}>
          <div 
            className="bg-neutral-900 border border-neutral-800 shadow-2xl rounded-2xl w-full max-w-md p-6 relative overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <button 
              onClick={() => !uploading && setIsModalOpen(false)}
              className="absolute top-4 right-4 text-neutral-500 hover:text-white transition-colors p-1"
            >
              <X className="w-6 h-6" />
            </button>
            
            <p className="text-base text-neutral-300 mb-4 text-center font-medium px-2">
              Você pode enviar até 10 fotos por envio
            </p>
            <p className="text-xs text-neutral-500 mb-6 text-center">
              Limite de 5 envios a cada 10 minutos.
            </p>
            
            <div className="mb-6">
              <label 
                htmlFor="file-upload"
                className="relative block cursor-pointer rounded-2xl bg-neutral-800/40 border-2 border-dashed border-neutral-700 hover:border-[#3CA0CC] hover:bg-[#3CA0CC]/10 transition-all duration-300 p-10 flex flex-col items-center justify-center text-center group"
              >
                {uploading && (
                  <div 
                    className="absolute bottom-0 left-0 h-1 bg-[#3CA0CC] transition-all duration-300 ease-out rounded-full" 
                    style={{ width: `${overallProgress}%` }}
                  ></div>
                )}
                <div className="w-16 h-16 rounded-full bg-[#3CA0CC]/15 flex items-center justify-center mb-4 transition-transform duration-300 group-hover:scale-110">
                  <Camera className="w-8 h-8 text-[#3CA0CC]" />
                </div>
                {selectedFiles.length > 0 ? (
                  <>
                    <span className="text-sm font-semibold text-white">
                      {selectedFiles.length} {selectedFiles.length === 1 ? "foto selecionada" : "fotos selecionadas"}
                    </span>
                    <span className="mt-1 text-xs text-neutral-400">Toque para adicionar mais</span>
                  </>
                ) : (
                  <>
                    <span className="text-sm font-semibold text-white">Toque para escolher suas fotos</span>
                    <span className="mt-1 text-xs text-neutral-400">JPEG, PNG ou WebP</span>
                  </>
                )}
                <input
                  id="file-upload"
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handleFileChange}
                  disabled={uploading}
                />
              </label>
              {uploading && (
                <div className="mt-3 text-center text-sm text-neutral-300 font-medium">
                  Enviando... {overallProgress}%
                </div>
              )}
            </div>

            {uploadStatus === "success" && (
              <div className="mb-6 p-3 bg-green-900/30 border border-green-800 text-green-400 rounded-lg flex items-center gap-2 text-sm">
                <CheckCircle2 className="w-5 h-5" />
                Enviado com sucesso!
              </div>
            )}
            
            {uploadStatus === "error" && (
              <div className="mb-6 p-3 bg-red-900/30 border border-red-800 text-red-400 rounded-lg flex flex-col gap-2 text-sm">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-5 h-5" />
                  Erro ao enviar. Tente novamente.
                </div>
                {errorMessage && (
                  <div className="text-xs text-red-300 opacity-80 mt-1 break-words">
                    Detalhes: {errorMessage}
                  </div>
                )}
              </div>
            )}

            <button 
              onClick={handleUpload}
              disabled={selectedFiles.length === 0 || uploading || uploadStatus === "success"}
              className="w-full bg-white text-black hover:bg-neutral-200 disabled:bg-neutral-800 disabled:text-neutral-500 font-semibold py-4 px-6 rounded-xl flex items-center justify-center gap-2 transition-colors"
            >
              {uploading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Enviando ({overallProgress}%)
                </>
              ) : uploadStatus === "success" ? (
                "Enviado"
              ) : (
                "Confirmar Envio"
              )}
            </button>
          </div>
        </div>
      )}

      {/* Lightbox Visualizador */}
      {lightboxIndex !== null && galleryPhotos[lightboxIndex] && (
        <div className="fixed inset-0 bg-black/95 z-[60] flex items-center justify-center" onClick={closeLightbox}>
          {/* Close button */}
          <button 
            onClick={closeLightbox}
            className="absolute top-6 right-6 text-white/70 hover:text-white p-2 z-[70] bg-black/20 rounded-full"
          >
            <X className="w-8 h-8" />
          </button>
          
          {/* Prev button */}
          <button 
            onClick={showPrevPhoto}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white p-3 z-[70] bg-black/20 hover:bg-black/40 rounded-full transition-all"
          >
            <ChevronLeft className="w-8 h-8" />
          </button>
          
          {/* Next button */}
          <button 
            onClick={showNextPhoto}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white p-3 z-[70] bg-black/20 hover:bg-black/40 rounded-full transition-all"
          >
            <ChevronRight className="w-8 h-8" />
          </button>

          {galleryPhotos[lightboxIndex].url_thumbnail && /\.(webp|jpe?g|png|gif)$/i.test(galleryPhotos[lightboxIndex].url_thumbnail) ? (
            <div 
              className="relative max-w-full max-h-[90vh] flex items-center justify-center"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Instant blurred thumbnail placeholder (cached from grid) */}
              <img 
                src={galleryPhotos[lightboxIndex].url_thumbnail} 
                alt="" 
                aria-hidden
                className="absolute inset-0 w-full h-full object-contain scale-110 blur-2xl opacity-60"
              />
              {/* Full original fades in once loaded */}
              <img 
                key={galleryPhotos[lightboxIndex].url_original}
                src={galleryPhotos[lightboxIndex].url_original} 
                alt="Original" 
                className="relative max-w-full max-h-[90vh] object-contain select-none"
                style={{ opacity: 0, transition: 'opacity 0.4s ease' }}
                onLoad={(e) => { e.currentTarget.style.opacity = '1'; }}
                onError={(e) => {
                  const target = e.currentTarget;
                  target.style.display = 'none';
                  const parent = target.parentElement;
                  if (parent && !parent.querySelector('.error-msg')) {
                    const errorMsg = document.createElement('div');
                    errorMsg.className = 'error-msg text-white text-center p-8 bg-neutral-900 rounded-lg';
                    errorMsg.innerHTML = '<h3>🔒 Imagem Bloqueada</h3><p class="text-neutral-400 mt-2">O bucket do seu MinIO não permite leitura pública.</p>';
                    parent.appendChild(errorMsg);
                  }
                }}
              />
            </div>
          ) : (
            <video 
              src={galleryPhotos[lightboxIndex].url_original} 
              preload="metadata"
              controls
              autoPlay
              className="max-w-full max-h-[90vh] object-contain select-none bg-black"
              onClick={(e) => e.stopPropagation()}
            />
          )}
          
           {/* Counter */}
           <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/60 text-sm font-medium tracking-wide">
             {lightboxIndex + 1} / {galleryPhotos.length}
           </div>
        </div>
      )}

      {/* Transient toast */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[80] bg-red-900/90 text-red-100 text-sm px-4 py-2 rounded-xl shadow-lg border border-red-700">
          {toast}
        </div>
      )}
    </div>
  );
}

