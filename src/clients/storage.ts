import * as Minio from 'minio'
import { config } from '../lib/config'

// Prefer the pod's IAM role when one is available — AWS_ROLE_ARN is what EKS
// injects when the ServiceAccount carries the eks.amazonaws.com/role-arn
// annotation. minio-js's IamAwsProvider resolves it (via
// AWS_WEB_IDENTITY_TOKEN_FILE, with an EC2/ECS instance-metadata fallback)
// and refreshes automatically before it expires. A pod can end up with both
// a role and static keys configured — the role wins in that case. Static
// keys are only used when no role is present (e.g. a non-AWS S3-compatible
// endpoint).
function buildClient(endpointURL: string) {
  const endpoint = new URL(endpointURL)
  const useSSL = endpoint.protocol === 'https:'
  const base = {
    endPoint: endpoint.hostname,
    port: endpoint.port ? Number(endpoint.port) : useSSL ? 443 : 80,
    useSSL,
    region: config.STORAGE_REGION,
    pathStyle: config.STORAGE_FORCE_PATH_STYLE,
  }
  if (process.env.AWS_ROLE_ARN) {
    return new Minio.Client({ ...base, credentialsProvider: new Minio.IamAwsProvider({}) })
  }
  return new Minio.Client({
    ...base,
    accessKey: config.STORAGE_ACCESS_KEY,
    secretKey: config.STORAGE_SECRET_KEY,
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
