# demo-app — código de prueba de la arquitectura

App mínima en Node.js/Express que ejercita las 3 piezas de la arquitectura que
tocan código directamente: **Elastic Beanstalk** (donde corre), **RDS vía
Secrets Manager**, y **S3**.

## Endpoints

| Ruta | Qué hace | Depende de |
|---|---|---|
| `GET /` | Health check simple, responde de inmediato | Nada (lo usa el ALB para saber si la instancia está sana) |
| `GET /db-test` | Lee las credenciales desde Secrets Manager, se conecta a RDS, crea una tabla `ping_test` si no existe, inserta una fila y devuelve las últimas 5 | Secrets Manager + RDS |
| `GET /s3-test` | Sube un archivo de texto pequeño al bucket S3 y lista los últimos 5 objetos | S3 |

## Variables de entorno

Ver `.env.example`. En producción (Beanstalk) estas se configuran como
"Environment properties", no como archivo `.env`:

- `SECRET_NAME` — nombre del secreto en Secrets Manager (ej. `demo-app/db-credentials`)
- `S3_BUCKET` — nombre del bucket
- `AWS_REGION` — región donde están tus recursos
- `PORT` — opcional, Beanstalk lo inyecta automáticamente

El secreto en Secrets Manager debe tener este formato JSON:

```json
{
  "host": "tu-rds-endpoint.rds.amazonaws.com",
  "port": 3306,
  "username": "appadmin",
  "password": "tu-password",
  "dbname": "appdb"
}
```

## Permisos IAM necesarios

El rol de instancia (instance profile) que usa el entorno de Beanstalk necesita
la policy en `iam-policy.json` — le da acceso de solo lectura al secreto
específico y de escritura/listado al bucket específico (no acceso genérico a
todo Secrets Manager o todo S3).

## Correr localmente

```bash
npm install
cp .env.example .env
# edita .env con tus valores reales
npm start
```

Nota: para probar `/db-test` y `/s3-test` en local necesitas credenciales de
AWS configuradas (`aws configure`) con permisos equivalentes a
`iam-policy.json`, y que tu máquina tenga red hacia la RDS (normalmente no la
tiene si la RDS está en subred privada — estos dos endpoints están pensados
para probarse una vez desplegados en Beanstalk, no en local).

## Estructura del repo

```
.
├── app.js            # lógica de los 3 endpoints
├── package.json
├── iam-policy.json    # policy IAM para el instance role de Beanstalk
├── .env.example
└── .gitignore
```
