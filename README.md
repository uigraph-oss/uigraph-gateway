# uigraph-gateway

[![license](https://img.shields.io/badge/license-BUSL--1.1-blue)](LICENSE)

HTTP gateway for [UiGraph](https://github.com/uigraph-oss) CLI and integration sync workflows. Built with [Hono](https://hono.dev/) and TypeScript, it exposes authenticated `/v1/sync` endpoints that bridge the UiGraph CLI to [uigraph-api](https://github.com/uigraph-oss/uigraph-api) and object storage.

## Features

- **Service sync** — push and pull service catalog metadata
- **Diagram sync** — upload and download diagram versions
- **Map sync** — sync system maps and frames
- **Docs sync** — upload service documentation and assets
- **Test sync** — sync API test definitions
- **Object storage** — direct MinIO/S3 integration for large file uploads

All `/v1/sync` routes require a service-account API key (`X-API-Key` header).

## Local development

The gateway is included in the [uigraph-deploy](../uigraph-deploy) dev stack:

```bash
cd ../uigraph-deploy
make docker-up
```

The gateway listens on `http://localhost:8081`. Health check: `GET /healthz`.

To run standalone:

```bash
pnpm install
pnpm dev
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | HTTP listen port |
| `UIGRAPH_API_URL` | — | Base URL of uigraph-api (required) |
| `STORAGE_ENDPOINT` | — | Object storage endpoint (required) |
| `STORAGE_PUBLIC_ENDPOINT` | — | Browser-reachable endpoint for presigned URLs |
| `STORAGE_BUCKET` | — | Storage bucket name (required) |
| `STORAGE_ACCESS_KEY` | — | Storage access key (required) |
| `STORAGE_SECRET_KEY` | — | Storage secret key (required) |
| `STORAGE_REGION` | `us-east-1` | Storage region |

## Testing

```bash
pnpm test
pnpm typecheck
```

## License

This project is licensed under the [Business Source License 1.1](LICENSE) (BUSL-1.1).

- **Source available today** — you can read, modify, and redistribute the code under the terms of the license.
- **Non-production use** — free for development, testing, evaluation, and internal proof-of-concept.
- **Production use** — requires a commercial license from UiGraph. Production use means any use that supports the ongoing operation of your business or organization.
- **Future open source** — each version automatically converts to [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) four years after it is first published under BUSL.

BUSL is not an OSI-approved open source license during the initial term. For commercial licensing questions, open an issue or contact the maintainers.

## Related projects

- [uigraph-api](https://github.com/uigraph-oss/uigraph-api) — backend API
- [uigraph-ui](https://github.com/uigraph-oss/uigraph-ui) — web application
- [uigraph-graphql](https://github.com/uigraph-oss/uigraph-graphql) — GraphQL BFF
- [uigraph-mcp](https://github.com/uigraph-oss/uigraph-mcp) — MCP server for AI assistants
- [uigraph-sdk](https://github.com/uigraph-oss/uigraph-sdk) — TypeScript SDK
- [uigraph-deploy](https://github.com/uigraph-oss/uigraph-deploy) — self-hosted deployment
- [uigraph-scripts](https://github.com/uigraph-oss/uigraph-scripts) — database seed utilities
