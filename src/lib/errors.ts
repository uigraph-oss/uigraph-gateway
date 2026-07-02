// ApiError carries an HTTP status and a message that the CLI surfaces directly.
// The Go CLI's formatGatewayError reads the JSON `message` field on 400/5xx.
export class ApiError extends Error {
  statusCode: number
  constructor(statusCode: number, message: string) {
    super(message)
    this.statusCode = statusCode
    this.name = 'ApiError'
  }
}
