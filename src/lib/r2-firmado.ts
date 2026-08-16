import { AwsClient } from "aws4fetch";

export interface BindingsR2 {
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_ACCOUNT_ID: string;
  R2_BUCKET_NAME: string;
}

interface OpcionesFirma {
  contentType?: string;
  expiresInSeconds?: number;
  extraParams?: Record<string, string>;
}

export async function firmarUrlR2(
  env: BindingsR2,
  method: "PUT" | "GET",
  key: string,
  opciones: OpcionesFirma = {}
): Promise<string> {
  const cliente = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  });

  const url = new URL(
    `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}/${key}`
  );
  url.searchParams.set("X-Amz-Expires", String(opciones.expiresInSeconds ?? 300));

  if (opciones.extraParams) {
    for (const [clave, valor] of Object.entries(opciones.extraParams)) {
      url.searchParams.set(clave, valor);
    }
  }

  const headers: Record<string, string> = {};
  if (method === "PUT" && opciones.contentType) {
    headers["Content-Type"] = opciones.contentType;
  }

  const firmada = await cliente.sign(new Request(url, { method, headers }), {
    aws: { signQuery: true },
  });

  return firmada.url;
}