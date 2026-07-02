import * as Minio from 'minio'
import { config } from '../lib/config'

function buildClient(endpointURL: string) {
  const endpoint = new URL(endpointURL)
  const useSSL = endpoint.protocol === 'https:'
  return new Minio.Client({
    endPoint: endpoint.hostname,
    port: endpoint.port ? Number(endpoint.port) : useSSL ? 443 : 80,
    useSSL,
    accessKey: config.STORAGE_ACCESS_KEY,
    secretKey: config.STORAGE_SECRET_KEY,
    region: config.STORAGE_REGION,
    pathStyle: config.STORAGE_FORCE_PATH_STYLE,
  })
}

const client = buildClient(config.STORAGE_ENDPOINT)
const presignClient = config.STORAGE_PUBLIC_ENDPOINT
  ? buildClient(config.STORAGE_PUBLIC_ENDPOINT)
  : client

export async function presignPut(
  key: string,
  contentType: string
): Promise<string> {
  return presignClient.presignedPutObject(config.STORAGE_BUCKET, key, 15 * 60)
}

export async function getObjectBytes(key: string): Promise<Buffer> {
  const stream = await client.getObject(config.STORAGE_BUCKET, key)
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}
