import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import sharp, { type FormatEnum } from "sharp";

const DEFAULT_MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const DEFAULT_MAX_PIXELS = 40_000_000;
const DEFAULT_MAX_DIMENSION = 4_000;
const DEFAULT_QUALITY = 82;

const SUPPORTED_INPUT_FORMATS = new Set([
  "jpeg",
  "png",
  "webp",
  "avif",
]);

export type SeoImageOutputFormat = "webp" | "jpeg" | "png" | "avif";

export type SeoImageInput = {
  body: Uint8Array | Buffer;
  originalName: string;
  contentType?: string | null;
  productName: string;
  variant?: string | null;
  productId: string;
  sequence: number;
  altText?: string | null;
  uploadedBy?: string | null;
  outputFormat?: SeoImageOutputFormat;
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
};

export type OptimizedImage = {
  body: Buffer;
  contentType: string;
  extension: "webp" | "jpg" | "png" | "avif";
  format: SeoImageOutputFormat;
  width: number;
  height: number;
  originalBytes: number;
  bytes: number;
};

export type SeoImageResult = {
  key: string;
  filename: string;
  url: string;
  contentType: string;
  format: SeoImageOutputFormat;
  width: number;
  height: number;
  originalBytes: number;
  bytes: number;
  altText: string;
};

export class SeoImageValidationError extends Error {
  readonly code = "SEO_IMAGE_VALIDATION_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "SeoImageValidationError";
  }
}

export class SeoImageConflictError extends Error {
  readonly code = "SEO_IMAGE_CONFLICT";

  constructor(message = "Já existe uma imagem com a mesma chave pública.") {
    super(message);
    this.name = "SeoImageConflictError";
  }
}

let s3Client: S3Client | undefined;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Variável de ambiente ausente: ${name}`);
  }
  return value;
}

function optionalPositiveInteger(name: string, fallback: number): number {
  const rawValue = process.env[name]?.trim();
  if (!rawValue) return fallback;

  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} deve ser um número inteiro positivo.`);
  }

  return value;
}

function getMaxImageBytes(): number {
  return optionalPositiveInteger("MAX_IMAGE_BYTES", DEFAULT_MAX_IMAGE_BYTES);
}

function getMaxPixels(): number {
  return optionalPositiveInteger("MAX_IMAGE_PIXELS", DEFAULT_MAX_PIXELS);
}

function getS3Client(): S3Client {
  if (s3Client) return s3Client;

  const endpoint = process.env.S3_ENDPOINT?.trim() || undefined;
  const accessKeyId = requiredEnv("S3_ACCESS_KEY_ID");
  const secretAccessKey = requiredEnv("S3_SECRET_ACCESS_KEY");

  s3Client = new S3Client({
    region: process.env.S3_REGION?.trim() || "auto",
    endpoint,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  return s3Client;
}

function getBucket(): string {
  return requiredEnv("S3_BUCKET");
}

function getPublicCdnBaseUrl(): string {
  return requiredEnv("PUBLIC_CDN_BASE_URL").replace(/\/+$/, "");
}

/**
 * Converte texto comercial em um segmento seguro para URL e object key.
 * Exemplo: "Corano Azul-Marinho" -> "corano-azul-marinho".
 */
export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " e ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 140);
}

function requiredSlug(value: string, label: string): string {
  const result = slugify(value);
  if (!result) {
    throw new SeoImageValidationError(
      `${label} não pode ficar vazio após a normalização.`,
    );
  }
  return result;
}

function normalizedText(
  value: string | null | undefined,
  label: string,
  maxLength: number,
): string | undefined {
  if (value == null) return undefined;

  const result = value.trim();
  if (!result) return undefined;
  if (result.length > maxLength) {
    throw new SeoImageValidationError(
      `${label} deve ter no máximo ${maxLength} caracteres.`,
    );
  }
  return result;
}

function contentTypeFor(format: SeoImageOutputFormat): string {
  switch (format) {
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "avif":
      return "image/avif";
    case "webp":
      return "image/webp";
  }
}

function extensionFor(format: SeoImageOutputFormat): OptimizedImage["extension"] {
  return format === "jpeg" ? "jpg" : format;
}

function normalizeOutputFormat(
  value: SeoImageOutputFormat | undefined,
): SeoImageOutputFormat {
  const candidate = value ?? process.env.IMAGE_OUTPUT_FORMAT ?? "webp";
  if (!(["webp", "jpeg", "png", "avif"] as string[]).includes(candidate)) {
    throw new SeoImageValidationError(
      "outputFormat deve ser webp, jpeg, png ou avif.",
    );
  }
  return candidate as SeoImageOutputFormat;
}

function normalizeQuality(value: number | undefined): number {
  const quality = value ?? Number(process.env.IMAGE_QUALITY ?? DEFAULT_QUALITY);
  if (!Number.isFinite(quality) || quality < 1 || quality > 100) {
    throw new SeoImageValidationError("quality deve estar entre 1 e 100.");
  }
  return Math.round(quality);
}

function normalizeDimension(value: number | undefined, label: string): number {
  const dimension = value ?? DEFAULT_MAX_DIMENSION;
  if (!Number.isSafeInteger(dimension) || dimension < 1 || dimension > 8_000) {
    throw new SeoImageValidationError(
      `${label} deve ser um inteiro entre 1 e 8000.`,
    );
  }
  return dimension;
}

function assertSupportedContentType(contentType?: string | null): void {
  if (!contentType) return;
  const normalized = contentType.toLowerCase().split(";", 1)[0];
  if (
    normalized !== "image/jpeg" &&
    normalized !== "image/png" &&
    normalized !== "image/webp" &&
    normalized !== "image/avif"
  ) {
    throw new SeoImageValidationError(
      "Tipo de imagem não suportado. Use JPG, PNG, WEBP ou AVIF.",
    );
  }
}

function assertSequence(sequence: number): void {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new SeoImageValidationError(
      "sequence deve ser um número inteiro maior ou igual a 1.",
    );
  }
}

function metadataValue(value: string): string {
  // S3 user metadata precisa ser compatível com US-ASCII. Base64 preserva
  // os dados originais sem inserir acentos ou caracteres de controle.
  return Buffer.from(value, "utf8").toString("base64");
}

function isPreconditionFailed(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    $metadata?: { httpStatusCode?: number };
    name?: string;
    Code?: string;
  };
  return (
    candidate.$metadata?.httpStatusCode === 412 ||
    candidate.name === "PreconditionFailed" ||
    candidate.Code === "PreconditionFailed"
  );
}

/**
 * Valida a imagem real, redimensiona sem ampliar e converte para o formato
 * público escolhido. O buffer original nunca é alterado.
 */
export async function optimizeImage(
  input: SeoImageInput["body"],
  options: Pick<SeoImageInput, "contentType" | "outputFormat" | "quality" | "maxWidth" | "maxHeight"> = {},
): Promise<OptimizedImage> {
  const source = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const maxImageBytes = getMaxImageBytes();

  if (source.byteLength === 0) {
    throw new SeoImageValidationError("O arquivo de imagem está vazio.");
  }
  if (source.byteLength > maxImageBytes) {
    throw new SeoImageValidationError(
      `A imagem excede o limite de ${Math.round(maxImageBytes / 1024 / 1024)} MB.`,
    );
  }

  assertSupportedContentType(options.contentType);

  let inputMetadata: sharp.Metadata;
  try {
    inputMetadata = await sharp(source, {
      limitInputPixels: getMaxPixels(),
    }).metadata();
  } catch {
    throw new SeoImageValidationError(
      "O conteúdo do arquivo não é uma imagem válida ou está corrompido.",
    );
  }

  if (
    !inputMetadata.format ||
    !SUPPORTED_INPUT_FORMATS.has(inputMetadata.format)
  ) {
    throw new SeoImageValidationError(
      "Formato real de imagem não suportado. Use JPG, PNG, WEBP ou AVIF.",
    );
  }

  const format = normalizeOutputFormat(options.outputFormat);
  const quality = normalizeQuality(options.quality);
  const maxWidth = normalizeDimension(options.maxWidth, "maxWidth");
  const maxHeight = normalizeDimension(options.maxHeight, "maxHeight");

  let pipeline = sharp(source, {
    limitInputPixels: getMaxPixels(),
    failOn: "error",
  }).rotate();

  pipeline = pipeline.resize({
    width: maxWidth,
    height: maxHeight,
    fit: "inside",
    withoutEnlargement: true,
  });

  const formatOptions: Record<string, unknown> = {
    webp: { quality, effort: 4 },
    jpeg: { quality, mozjpeg: true, progressive: true },
    png: { compressionLevel: 9, adaptiveFiltering: true },
    avif: { quality, effort: 4 },
  };

  pipeline = pipeline.toFormat(
    format as keyof FormatEnum,
    formatOptions[format] as never,
  );

  const optimizedBody = await pipeline.toBuffer();
  const outputMetadata = await sharp(optimizedBody).metadata();

  if (!outputMetadata.width || !outputMetadata.height) {
    throw new Error("Não foi possível determinar as dimensões da imagem otimizada.");
  }

  return {
    body: optimizedBody,
    contentType: contentTypeFor(format),
    extension: extensionFor(format),
    format,
    width: outputMetadata.width,
    height: outputMetadata.height,
    originalBytes: source.byteLength,
    bytes: optimizedBody.byteLength,
  };
}

/**
 * Faz upload de uma imagem otimizada usando uma object key determinística.
 * A condição IfNoneMatch evita sobrescrever uma imagem já existente.
 */
export async function uploadSeoImage(
  input: SeoImageInput,
): Promise<SeoImageResult> {
  assertSequence(input.sequence);

  const productName = normalizedText(input.productName, "productName", 512);
  if (!productName) {
    throw new SeoImageValidationError("productName é obrigatório.");
  }

  const productId = normalizedText(input.productId, "productId", 160);
  if (!productId) {
    throw new SeoImageValidationError("productId é obrigatório.");
  }

  const productSlug = requiredSlug(productName, "productName");
  const productIdSlug = requiredSlug(productId, "productId");
  const variant = normalizedText(input.variant, "variant", 512);
  const variantSlug = variant ? slugify(variant) : "";
  const originalName = normalizedText(input.originalName, "originalName", 512);
  if (!originalName) {
    throw new SeoImageValidationError("originalName é obrigatório.");
  }

  const altText =
    normalizedText(input.altText, "altText", 512) ??
    [productName, variant].filter(Boolean).join(" ");
  const uploadedBy = normalizedText(input.uploadedBy, "uploadedBy", 160);
  const optimized = await optimizeImage(input.body, {
    contentType: input.contentType,
    outputFormat: input.outputFormat,
    quality: input.quality,
    maxWidth: input.maxWidth,
    maxHeight: input.maxHeight,
  });

  const sequence = String(input.sequence).padStart(2, "0");
  const filename = [productSlug, variantSlug, sequence]
    .filter(Boolean)
    .join("-") + `.${optimized.extension}`;
  const key = `products/${productIdSlug}/${filename}`;

  try {
    await getS3Client().send(
      new PutObjectCommand({
        Bucket: getBucket(),
        Key: key,
        Body: optimized.body,
        ContentType: optimized.contentType,
        CacheControl: "public, max-age=31536000, immutable",
        Metadata: {
          product_id: metadataValue(productId),
          product_name: metadataValue(productName),
          original_name: metadataValue(originalName),
          alt_text: metadataValue(altText),
          ...(variant ? { variant: metadataValue(variant) } : {}),
          ...(uploadedBy ? { uploaded_by: metadataValue(uploadedBy) } : {}),
        },
        IfNoneMatch: "*",
      }),
    );
  } catch (error) {
    if (isPreconditionFailed(error)) {
      throw new SeoImageConflictError(
        `A imagem ${filename} já existe. Use outra sequence para evitar colisão.`,
      );
    }
    throw error;
  }

  const publicCdnBaseUrl = getPublicCdnBaseUrl();
  const encodedKey = key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return {
    key,
    filename,
    url: `${publicCdnBaseUrl}/${encodedKey}`,
    contentType: optimized.contentType,
    format: optimized.format,
    width: optimized.width,
    height: optimized.height,
    originalBytes: optimized.originalBytes,
    bytes: optimized.bytes,
    altText,
  };
}
