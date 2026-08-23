const express = require("express");
const mysql = require("mysql2/promise");
const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");
const {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
} = require("@aws-sdk/client-s3");

const app = express();
const PORT = process.env.PORT || 8080;
const REGION = process.env.AWS_REGION || "us-east-1";

// Estas dos variables si son env vars normales (no son secretas):
// - SECRET_NAME: el nombre del secreto en Secrets Manager (ej. "demo-app/db-credentials")
// - S3_BUCKET: el nombre de tu bucket
const SECRET_NAME = process.env.SECRET_NAME;
const S3_BUCKET = process.env.S3_BUCKET;

const secretsClient = new SecretsManagerClient({ region: REGION });
const s3Client = new S3Client({ region: REGION });

// Cacheamos el secreto en memoria para no llamar a Secrets Manager en cada request
// (cada llamada a GetSecretValue tiene un costo pequeno pero real).
let cachedDbConfig = null;

async function getDbConfig() {
  if (cachedDbConfig) return cachedDbConfig;

  const command = new GetSecretValueCommand({ SecretId: SECRET_NAME });
  const response = await secretsClient.send(command);
  const secret = JSON.parse(response.SecretString);

  cachedDbConfig = {
    host: secret.host,
    port: secret.port || 3306,
    user: secret.username,
    password: secret.password,
    database: secret.dbname,
    connectTimeout: 5000,
  };
  return cachedDbConfig;
}

// 1) UI simple para probar los endpoints desde el navegador.
app.get("/", (req, res) => {
  res.status(200).type("html").send(`<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Demo App Tests</title>
    <style>
      :root {
        --bg: #f6f8fb;
        --card: #ffffff;
        --text: #1f2937;
        --muted: #6b7280;
        --border: #d1d5db;
        --primary: #0f766e;
        --primary-hover: #115e59;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
        color: var(--text);
        background: radial-gradient(circle at top right, #dbeafe 0%, var(--bg) 45%);
      }

      .container {
        max-width: 900px;
        margin: 40px auto;
        padding: 0 16px;
      }

      .card {
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 20px;
        box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
      }

      h1 {
        margin: 0 0 8px;
        font-size: 1.6rem;
      }

      p {
        margin: 0 0 18px;
        color: var(--muted);
      }

      .buttons {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }

      button {
        border: 0;
        border-radius: 10px;
        padding: 10px 14px;
        background: var(--primary);
        color: #ffffff;
        font-weight: 600;
        cursor: pointer;
      }

      button:hover {
        background: var(--primary-hover);
      }

      button:disabled {
        opacity: 0.7;
        cursor: not-allowed;
      }

      .status {
        margin-top: 16px;
        font-size: 0.95rem;
      }

      pre {
        margin-top: 12px;
        background: #0b1220;
        color: #dbeafe;
        border-radius: 10px;
        padding: 14px;
        overflow: auto;
        min-height: 190px;
      }
    </style>
  </head>
  <body>
    <main class="container">
      <section class="card">
        <h1>Pruebas de DB y S3</h1>
        <p>Usa los botones para ejecutar los endpoints de prueba y ver su respuesta JSON.</p>

        <div class="buttons">
          <button id="dbBtn">Probar /db-test</button>
          <button id="s3Btn">Probar /s3-test</button>
        </div>

        <div id="status" class="status">Listo para ejecutar pruebas.</div>
        <pre id="output">Esperando respuesta...</pre>
      </section>
    </main>

    <script>
      const dbBtn = document.getElementById("dbBtn");
      const s3Btn = document.getElementById("s3Btn");
      const statusEl = document.getElementById("status");
      const outputEl = document.getElementById("output");

      function setLoading(isLoading) {
        dbBtn.disabled = isLoading;
        s3Btn.disabled = isLoading;
      }

      async function runTest(path) {
        setLoading(true);
        statusEl.textContent = "Consultando " + path + "...";
        outputEl.textContent = "Cargando...";

        try {
          const response = await fetch(path);
          const data = await response.json();
          statusEl.textContent = "Resultado " + path + ": HTTP " + response.status;
          outputEl.textContent = JSON.stringify(data, null, 2);
        } catch (error) {
          statusEl.textContent = "Error al consultar " + path;
          outputEl.textContent = JSON.stringify(
            {
              status: "error",
              message: error.message,
            },
            null,
            2
          );
        } finally {
          setLoading(false);
        }
      }

      dbBtn.addEventListener("click", () => runTest("/db-test"));
      s3Btn.addEventListener("click", () => runTest("/s3-test"));
    </script>
  </body>
</html>`);
});

// Health check simple: no depende de RDS ni de Secrets Manager.
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    message: "La app esta corriendo detras del ALB y Beanstalk",
    timestamp: new Date().toISOString(),
  });
});

// 2) Prueba RDS + Secrets Manager: obtiene las credenciales del secreto,
//    se conecta, crea una tabla de prueba, inserta y lee.
app.get("/db-test", async (req, res) => {
  let connection;
  try {
    const dbConfig = await getDbConfig();
    connection = await mysql.createConnection(dbConfig);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS ping_test (
        id INT AUTO_INCREMENT PRIMARY KEY,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await connection.query("INSERT INTO ping_test () VALUES ()");
    const [rows] = await connection.query(
      "SELECT id, created_at FROM ping_test ORDER BY id DESC LIMIT 5",
    );

    res.status(200).json({
      status: "ok",
      message:
        "Credenciales obtenidas de Secrets Manager, conexion a RDS exitosa",
      recent_pings: rows,
    });
  } catch (err) {
    res.status(500).json({
      status: "error",
      message: "Fallo la conexion a RDS o la lectura del secreto",
      error: err.message,
    });
  } finally {
    if (connection) await connection.end();
  }
});

// 3) Prueba S3: sube un archivo de texto pequeno y lista el contenido del bucket.
app.get("/s3-test", async (req, res) => {
  try {
    const key = `ping-test/${Date.now()}.txt`;
    const body = `ping desde la app - ${new Date().toISOString()}`;

    await s3Client.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: "text/plain",
      }),
    );

    const listResult = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: S3_BUCKET,
        Prefix: "ping-test/",
        MaxKeys: 5,
      }),
    );

    res.status(200).json({
      status: "ok",
      message: "Archivo subido a S3 via Gateway Endpoint",
      uploaded_key: key,
      recent_objects: (listResult.Contents || []).map((obj) => obj.Key),
    });
  } catch (err) {
    res.status(500).json({
      status: "error",
      message: "Fallo la subida o lectura en S3",
      error: err.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});
