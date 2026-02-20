# Health Module

Health check endpoint for monitoring and orchestration (Kubernetes, Docker Swarm, etc.).

## Endpoints

- `GET /health` - General health check
- `GET /health/db` - Database connectivity check (optional)
- `GET /health/redis` - Redis connectivity check (optional)

## Response

```json
{
  "status": "ok",
  "timestamp": "2026-02-14T12:00:00.000Z",
  "uptime": 3600.5,
  "database": "connected",
  "redis": "connected"
}
```

## Usage in Kubernetes

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 30
  periodSeconds: 10

readinessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 5
```

## Documentation

See [docs/12-OBSERVABILITY_SETUP_COMPLETE.md](../../../docs/12-OBSERVABILITY_SETUP_COMPLETE.md) for complete monitoring setup.
