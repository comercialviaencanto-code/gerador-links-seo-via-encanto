"use client";

import {
  ChangeEvent,
  DragEvent,
  KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import styles from "./upload.module.css";
import { LOGO_DATA_URL } from "../../lib/logo";

const UPLOADER_NAME_STORAGE_KEY = "via-encanto-uploader-name";

const ACCEPTED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
]);
const ACCEPTED_ATTRIBUTE = "image/jpeg,image/png,image/webp,image/avif";
const MAX_FILES = 20;

type SelectedFile = {
  id: string;
  file: File;
  previewUrl: string;
};

type UploadResult = {
  key: string;
  originalName: string;
  sequence: number;
  filename: string;
  url: string;
  contentType: string;
  width: number;
  height: number;
  bytes: number;
  altText: string;
};

type UploadError = {
  originalName: string;
  sequence: number;
  message: string;
};

type UploadResponse = {
  success: boolean;
  count?: number;
  results?: UploadResult[];
  errors?: UploadError[];
  error?: string;
};

function createFileId(file: File): string {
  return `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizeFiles(fileList: FileList | File[]): File[] {
  return Array.from(fileList).filter((file) => ACCEPTED_TYPES.has(file.type));
}

export default function UploadImagesPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<SelectedFile[]>([]);
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [uploaderName, setUploaderName] = useState("");
  const [productId, setProductId] = useState("");
  const [productName, setProductName] = useState("");
  const [variant, setVariant] = useState("");
  const [sequence, setSequence] = useState("1");
  const [outputFormat, setOutputFormat] = useState("webp");
  const [quality, setQuality] = useState("82");
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [uploadErrors, setUploadErrors] = useState<UploadError[]>([]);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    return () => {
      filesRef.current.forEach((entry) => URL.revokeObjectURL(entry.previewUrl));
    };
  }, []);

  useEffect(() => {
    const storedName = window.localStorage.getItem(UPLOADER_NAME_STORAGE_KEY);
    if (storedName) setUploaderName(storedName);
  }, []);

  function handleUploaderNameChange(value: string) {
    setUploaderName(value);
    window.localStorage.setItem(UPLOADER_NAME_STORAGE_KEY, value);
  }

  async function handleLogout() {
    setIsLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  function addFiles(fileList: FileList | File[]) {
    const acceptedFiles = normalizeFiles(fileList);
    const rejectedCount = Array.from(fileList).length - acceptedFiles.length;
    const availableSlots = Math.max(0, MAX_FILES - files.length);
    const filesToAdd = acceptedFiles.slice(0, availableSlots);

    if (rejectedCount > 0) {
      setError("Alguns arquivos foram ignorados. Use JPG, PNG, WEBP ou AVIF.");
    } else if (acceptedFiles.length > availableSlots) {
      setError(`É possível selecionar no máximo ${MAX_FILES} imagens.`);
    } else {
      setError(null);
    }

    const entries = filesToAdd.map((file) => ({
      id: createFileId(file),
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setFiles((current) => [...current, ...entries]);
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) addFiles(event.target.files);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (event.dataTransfer.files.length > 0) {
      addFiles(event.dataTransfer.files);
    }
  }

  function handleDropzoneKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      inputRef.current?.click();
    }
  }

  function removeFile(id: string) {
    setFiles((current) => {
      const entry = current.find((item) => item.id === id);
      if (entry) URL.revokeObjectURL(entry.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  }

  function clearFiles() {
    files.forEach((entry) => URL.revokeObjectURL(entry.previewUrl));
    setFiles([]);
    setResults([]);
    setUploadErrors([]);
    setMessage(null);
    setError(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    setResults([]);
    setUploadErrors([]);

    if (!productId.trim() || !productName.trim()) {
      setError("Informe o ID e o nome do produto antes de enviar.");
      return;
    }
    if (files.length === 0) {
      setError("Selecione pelo menos uma imagem.");
      return;
    }

    const formData = new FormData();
    formData.set("productId", productId.trim());
    formData.set("productName", productName.trim());
    if (variant.trim()) formData.set("variant", variant.trim());
    if (uploaderName.trim()) formData.set("uploadedBy", uploaderName.trim());
    formData.set("sequence", sequence || "1");
    formData.set("outputFormat", outputFormat);
    formData.set("quality", quality || "82");
    files.forEach((entry) => formData.append("files", entry.file, entry.file.name));

    try {
      setIsUploading(true);

      const response = await fetch("/api/images", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as UploadResponse;

      if (response.status === 401) {
        router.replace("/login?next=/upload");
        router.refresh();
        return;
      }

      setResults(payload.results ?? []);
      setUploadErrors(payload.errors ?? []);

      if (!response.ok && response.status !== 207) {
        throw new Error(payload.error ?? "Não foi possível concluir o upload.");
      }

      if ((payload.errors ?? []).length > 0) {
        setMessage(
          `${payload.results?.length ?? 0} imagem(ns) enviada(s); confira as falhas abaixo.`,
        );
      } else {
        setMessage(`${payload.count ?? 0} imagem(ns) enviada(s) com sucesso.`);
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Falha de comunicação com a API.",
      );
    } finally {
      setIsUploading(false);
    }
  }

  async function copyUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setMessage("URL copiada para a área de transferência.");
    } catch {
      setError("Não foi possível copiar automaticamente. Selecione a URL manualmente.");
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.shell}>
        <header className={styles.header}>
          <div>
            <img
              src={LOGO_DATA_URL}
              alt="Via Encanto"
              style={{ width: 150, marginBottom: 18, display: "block" }}
            />
            <p className={styles.eyebrow}>Gerador de imagens SEO-friendly</p>
            <h1>Envie as fotos do produto</h1>
            <p className={styles.subtitle}>
              Arraste as imagens, informe os dados comerciais e receba URLs públicas
              com nomes descritivos para o catálogo.
            </p>
          </div>
          <div style={{ display: "grid", justifyItems: "end", gap: 10 }}>
            <div className={styles.badge}>S3 / R2</div>
            <button
              type="button"
              onClick={handleLogout}
              disabled={isLoggingOut}
              style={{
                border: 0,
                background: "transparent",
                color: "#8192a0",
                fontSize: "0.78rem",
                fontWeight: 700,
                cursor: isLoggingOut ? "not-allowed" : "pointer",
                textDecoration: "underline",
                padding: 0,
              }}
            >
              {isLoggingOut ? "Saindo…" : "Sair"}
            </button>
          </div>
        </header>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.layout}>
            <section className={styles.panel} aria-labelledby="product-data-title">
              <div className={styles.panelHeading}>
                <p className={styles.step}>01</p>
                <div>
                  <h2 id="product-data-title">Dados do produto</h2>
                  <p>Esses dados definem o nome público da imagem.</p>
                </div>
              </div>

              <div className={styles.fields}>
                <label>
                  Quem está enviando
                  <input
                    value={uploaderName}
                    onChange={(event) => handleUploaderNameChange(event.target.value)}
                    placeholder="Seu nome"
                  />
                </label>
                <label>
                  ID do produto
                  <input
                    value={productId}
                    onChange={(event) => setProductId(event.target.value)}
                    placeholder="Ex.: 123"
                    required
                  />
                </label>
                <label>
                  Nome do produto
                  <input
                    value={productName}
                    onChange={(event) => setProductName(event.target.value)}
                    placeholder="Ex.: Namoradeira Chesterfield Duque"
                    required
                  />
                </label>
                <label>
                  Variante ou acabamento
                  <input
                    value={variant}
                    onChange={(event) => setVariant(event.target.value)}
                    placeholder="Ex.: Corano azul-marinho"
                  />
                </label>
                <div className={styles.twoColumns}>
                  <label>
                    Sequência inicial
                    <input
                      type="number"
                      min="1"
                      value={sequence}
                      onChange={(event) => setSequence(event.target.value)}
                    />
                  </label>
                  <label>
                    Formato final
                    <select
                      value={outputFormat}
                      onChange={(event) => setOutputFormat(event.target.value)}
                    >
                      <option value="webp">WEBP</option>
                      <option value="jpeg">JPEG</option>
                      <option value="png">PNG</option>
                      <option value="avif">AVIF</option>
                    </select>
                  </label>
                </div>
                <label>
                  Qualidade de compressão: <strong>{quality}</strong>
                  <input
                    type="range"
                    min="1"
                    max="100"
                    value={quality}
                    onChange={(event) => setQuality(event.target.value)}
                  />
                </label>
              </div>
            </section>

            <section className={styles.panel} aria-labelledby="images-title">
              <div className={styles.panelHeading}>
                <p className={styles.step}>02</p>
                <div>
                  <h2 id="images-title">Imagens</h2>
                  <p>Até {MAX_FILES} arquivos JPG, PNG, WEBP ou AVIF.</p>
                </div>
              </div>

              <div
                className={`${styles.dropzone} ${isDragging ? styles.dropzoneActive : ""}`}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={(event) => {
                  if (event.currentTarget === event.target) setIsDragging(false);
                }}
                onDrop={handleDrop}
                onClick={() => inputRef.current?.click()}
                onKeyDown={handleDropzoneKeyDown}
                role="button"
                tabIndex={0}
                aria-label="Área para arrastar imagens ou abrir o seletor de arquivos"
              >
                <input
                  ref={inputRef}
                  className={styles.hiddenInput}
                  type="file"
                  accept={ACCEPTED_ATTRIBUTE}
                  multiple
                  onChange={handleInputChange}
                />
                <div className={styles.uploadIcon} aria-hidden="true">↑</div>
                <strong>Arraste e solte as imagens aqui</strong>
                <span>ou clique para selecionar no computador</span>
              </div>

              {files.length > 0 ? (
                <div className={styles.fileList}>
                  {files.map((entry, index) => (
                    <article className={styles.fileCard} key={entry.id}>
                      <img src={entry.previewUrl} alt={`Prévia de ${entry.file.name}`} />
                      <div className={styles.fileInfo}>
                        <strong>{String(index + Number(sequence || 1)).padStart(2, "0")}</strong>
                        <span title={entry.file.name}>{entry.file.name}</span>
                        <small>{formatBytes(entry.file.size)}</small>
                      </div>
                      <button
                        type="button"
                        className={styles.removeButton}
                        onClick={(event) => {
                          event.stopPropagation();
                          removeFile(entry.id);
                        }}
                        aria-label={`Remover ${entry.file.name}`}
                      >
                        ×
                      </button>
                    </article>
                  ))}
                </div>
              ) : (
                <p className={styles.emptyState}>Nenhuma imagem selecionada.</p>
              )}
            </section>
          </div>

          {(error || message) && (
            <div className={error ? styles.alertError : styles.alertSuccess} role="status">
              {error ?? message}
            </div>
          )}

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={clearFiles}
              disabled={isUploading || files.length === 0}
            >
              Limpar seleção
            </button>
            <button type="submit" className={styles.primaryButton} disabled={isUploading}>
              {isUploading ? "Enviando imagens…" : "Gerar links públicos"}
            </button>
          </div>
        </form>

        {(results.length > 0 || uploadErrors.length > 0) && (
          <section className={styles.results} aria-labelledby="results-title">
            <div className={styles.panelHeading}>
              <p className={styles.step}>03</p>
              <div>
                <h2 id="results-title">Resultado do processamento</h2>
                <p>Confira e copie as URLs geradas.</p>
              </div>
            </div>

            <div className={styles.resultList}>
              {results.map((result) => (
                <article className={styles.resultCard} key={result.key}>
                  <div>
                    <strong>{result.filename}</strong>
                    <span>{result.width} × {result.height} px · {formatBytes(result.bytes)}</span>
                  </div>
                  <div className={styles.urlRow}>
                    <a href={result.url} target="_blank" rel="noreferrer">
                      {result.url}
                    </a>
                    <button type="button" onClick={() => copyUrl(result.url)}>
                      Copiar
                    </button>
                  </div>
                </article>
              ))}
              {uploadErrors.map((item) => (
                <article className={styles.resultCardError} key={`${item.originalName}-${item.sequence}`}>
                  <strong>{item.originalName}</strong>
                  <span>Sequência {String(item.sequence).padStart(2, "0")}: {item.message}</span>
                </article>
              ))}
            </div>
          </section>
        )}
      </section>
    </main>
  );
}
