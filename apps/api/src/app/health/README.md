# Health Module

Provides three HTTP endpoints used for monitoring, observability, and container orchestration.

---

## Endpoints

### `GET /health` — Full health check

Probes the database (PostgreSQL) and Redis. Returns per-service status and round-trip latency.

```json
{
  "status": "ok",
  "timestamp": "2026-02-26T12:34:56.789Z",
  "services": {
    "database": { "status": "ok", "responseTime": 4 },
    "redis": { "status": "ok", "responseTime": 1 }
  }
}
```

`status` values: `"ok"` | `"degraded"` | `"error"`

---

### `GET /health/liveness` — Liveness probe

Confirms that the Node.js process is alive. Does **not** check external dependencies — a non-responsive database does not affect this probe.

```json
{ "status": "ok" }
```

Return codes: `200 OK` always (if the process is dead, it cannot respond at all).

---

### `GET /health/readiness` — Readiness probe

Verifies that the application is ready to serve traffic (PostgreSQL + Redis reachable).

```json
{ "status": "ok",       "ready": true  }
{ "status": "not ready", "ready": false }
```

---

## Kubernetes / ECS probe configuration

```yaml
livenessProbe:
  httpGet:
    path: /health/liveness
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 10
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /health/readiness
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 5
  failureThreshold: 2
```

Use `/health/liveness` for liveness (restart decision) and `/health/readiness` for readiness (traffic routing).  
Use `/health` in uptime monitors (e.g. UptimeRobot, Datadog synthetics) to get a richer signal.

---

## Adding a new dependency check

1. Implement the check in `health.service.ts` (`checkHealth()` and `checkReadiness()`).
2. Add the result to the `services` object in `checkHealth()`.
3. Update the Swagger `schema` in `health.controller.ts` to document the new field.
4. Update this README.
