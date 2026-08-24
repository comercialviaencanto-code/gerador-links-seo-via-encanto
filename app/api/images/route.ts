import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  SeoImageConflictError,
  SeoImageValidationError,
  uploadSeoImage,
} from "../../../lib/seo-image-upload";
import { isValidSessionCookieValue, SESSION_COOKIE_NAME } from "../../../lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_MAX_UPLOAD_FILES = 20;
const DEFAULT_MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const IMAGE_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
]);

type UploadError = {
  originalName: string;
  sequence: number;
  message: string;
};

function getPositiveIntegerEnv(name: string, fallback: number): number {
  const rawValue = process.env[name]?.trim();
  if (!rawValue) return fallback;

  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} deve ser um número inteiro positivo.`);
  }
  return value;
}

function getRequiredText(formData: FormData, name: string): string {
  const value = formData.get(name);
  if (typeof value !== "string" || !value.trim()) {
    throw new SeoImageValidationError(`O campo ${name} é obrigatório.`);
  }
  return value.trim();
}

function getOptionalText(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  if (value == null) return undefined;
  if (typeof value !== "string") {
    throw new SeoImageValidationError(`O campo ${name} deve ser texto.`);
  }
  const normalized = value.trim();
  return normalized || undefined;
}

function getOptionalNumber(
  formData: FormData,
  name: string,
): number | undefined {
  const value = getOptionalText(formData, name);
  if (value == null) return undefined;

  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new SeoImageValidationError(`${name} deve ser numérico.`);
  }
  return numberValue;
}

function getOptionalInteger(
  formData: FormData,
  name: string,
): number | undefined {
  const value = getOptionalText(formData, name);
  if (value == null) return undefined;

  const numberValue = Number(value);
  if (!Number.isSafeInteger(numberValue)) {
    throw new SeoImageValidationError(`${name} deve ser um número inteiro.`);
  }
  return numberValue;
}

function getFiles(formData: FormData): File[] {
  const values = [
    ...formData.getAll("files"),
    ...formData.getAll("file"),
  ];
  const files = values.filter((value): value is File => value instanceof File);

  if (files.length === 0) {
    throw new SeoImageValidationError(
      "Envie pelo menos uma imagem nos campos files ou file.",
    );
  }

  const maxFiles = getPositiveIntegerEnv(
    "MAX_UPLOAD_FILES",
    DEFAULT_MAX_UPLOAD_FILES,
  );
  if (files.length > maxFiles) {
    throw new SeoImageValidationError(
      `É permitido enviar no máximo ${maxFiles} imagens por requisição.`,
    );
  }

  const maxImageBytes = getPositiveIntegerEnv(
    "MAX_IMAGE_BYTES",
    DEFAULT_MAX_IMAGE_BYTES,
  );

  for (const file of files) {
    if (file.size === 0) {
      throw new SeoImageValidationError(
        `O arquivo ${file.name || "sem nome"} está vazio.`,
      );
    }
    if (file.size > maxImageBytes) {
      throw new SeoImageValidationError(
        `O arquivo ${file.name || "sem nome"} excede o limite de ${Math.round(maxImageBytes / 1024 / 1024)} MB.`,
      );
    }

    const contentType = file.type.toLowerCase().split(";", 1)[0];
    if (contentType && !IMAGE_CONTENT_TYPES.has(contentType)) {
      throw new SeoImageValidationError(
        `O arquivo ${file.name || "sem nome"} não é JPG, PNG, WEBP ou AVIF.`,
      );
    }
  }

  return files;
}

function parseSequences(formData: FormData, fileCount: number): number[] {
  const sequencesText = getOptionalText(formData, "sequences");
  if (sequencesText) {
    const sequences = sequencesText.split(",").map((value) => Number(value.trim()));
    if (
      sequences.length !== fileCount ||
      sequences.some((value) => !Number.isSafeInteger(value) || value < 1)
    ) {
      throw new SeoImageValidationError(
        "sequences deve conter um número inteiro positivo para cada arquivo, separados por vírgula.",
      );
    }
    return sequences;
  }

  const firstSequence = getOptionalInteger(formData, "sequence") ?? 1;
  if (firstSequence < 1) {
    throw new SeoImageValidationError("sequence deve ser maior ou igual a 1.");
  }

  return filesCountSequence(firstSequence, fileCount);
}

function filesCountSequence(firstSequence: number, fileCount: number): number[] {
  return Array.from({ length: fileCount }, (_, index) => firstSequence + index);
}

function getBearerToken(request: Request): string | undefined {
  const authorization = request.headers.get("authorization")?.trim();
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length).trim() || undefined;
  }
  return request.headers.get("x-upload-token")?.trim() || undefined;
}

function tokensEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function getCookieValue(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return undefined;

  for (const part of cookieHeader.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = part.slice(0, separatorIndex).trim();
    if (key !== name) continue;
    const value = part.slice(separatorIndex + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return undefined;
}

async function authorizeUpload(request: Request): Promise<void> {
  // Sessão de login (cookie) é o caminho normal vindo da interface web.
  const sessionCookie = getCookieValue(request, SESSION_COOKIE_NAME);
  if (await isValidSessionCookieValue(sessionCookie)) {
    return;
  }

  const expectedToken = process.env.UPLOAD_API_TOKEN?.trim();
  const isProduction = process.env.NODE_ENV === "production";

  if (!expectedToken) {
    if (isProduction) {
      throw new UploadAuthorizationError(
        "UPLOAD_API_TOKEN deve ser configurado em produção.",
      );
    }
    return;
  }

  const receivedToken = getBearerToken(request);
  if (!receivedToken || !tokensEqual(receivedToken, expectedToken)) {
    throw new UploadAuthorizationError(
      "Sessão expirada ou token de upload inválido. Faça login novamente.",
    );
  }
}

class UploadAuthorizationError extends Error {
  readonly code = "UPLOAD_UNAUTHORIZED";

  constructor(message: string) {
    super(message);
    this.name = "UploadAuthorizationError";
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Falha inesperada ao processar o upload.";
}

function statusForError(error: unknown): number {
  if (error instanceof UploadAuthorizationError) return 401;
  if (error instanceof SeoImageConflictError) return 409;
  if (error instanceof SeoImageValidationError) return 400;
  return 500;
}

function jsonError(error: unknown): NextResponse {
  const status = statusForError(error);
  if (status >= 500) {
    console.error("[images/upload] erro interno", error);
  }

  return NextResponse.json(
    {
      success: false,
      error: status >= 500 ? "Falha interna ao processar o upload." : errorMessage(error),
    },
    { status },
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    await authorizeUpload(request);

    const formData = await request.formData();
    const productId = getRequiredText(formData, "productId");
    const productName = getRequiredText(formData, "productName");
    const variant = getOptionalText(formData, "variant");
    const altText = getOptionalText(formData, "altText");
    const uploadedBy = getOptionalText(formData, "uploadedBy");
    const outputFormat = getOptionalText(formData, "outputFormat") as
      | "webp"
      | "jpeg"
      | "png"
      | "avif"
      | undefined;
    const quality = getOptionalNumber(formData, "quality");
    const maxWidth = getOptionalInteger(formData, "maxWidth");
    const maxHeight = getOptionalInteger(formData, "maxHeight");
    const files = getFiles(formData);
    const sequences = parseSequences(formData, files.length);

    const results = [];
    const errors: UploadError[] = [];

    // O processamento sequencial limita o pico de memória e evita que muitos
    // buffers de imagem sejam decodificados simultaneamente.
    for (const [index, file] of files.entries()) {
      const sequence = sequences[index]!;
      try {
        const result = await uploadSeoImage({
          body: Buffer.from(await file.arrayBuffer()),
          originalName: file.name || `imagem-${sequence}`,
          contentType: file.type || undefined,
          productName,
          variant,
          productId,
          sequence,
          altText,
          uploadedBy,
          outputFormat,
          quality,
          maxWidth,
          maxHeight,
        });
        results.push({
          originalName: file.name,
          sequence,
          ...result,
        });
      } catch (error) {
        const status = statusForError(error);
        if (status >= 500) {
          console.error("[images/upload] falha no arquivo", {
            fileName: file.name,
            sequence,
            error,
          });
        }
        errors.push({
          originalName: file.name,
          sequence,
          message:
            status >= 500
              ? "Falha interna ao processar este arquivo."
              : errorMessage(error),
        });
      }
    }

    const success = errors.length === 0;
    const status = success ? 201 : results.length > 0 ? 207 : 400;

    return NextResponse.json(
      {
        success,
        count: results.length,
        results,
        errors,
      },
      { status },
    );
  } catch (error) {
    if (error instanceof TypeError) {
      return NextResponse.json(
        {
          success: false,
          error: "Envie os dados como multipart/form-data com pelo menos um arquivo.",
        },
        { status: 400 },
      );
    }
    return jsonError(error);
  }
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    {
      success: false,
      error: "Método não permitido. Use POST multipart/form-data.",
    },
    { status: 405, headers: { Allow: "POST" } },
  );
}
