const dbNoteInput = document.getElementById("dbNoteInput");
const dbCreateBtn = document.getElementById("dbCreateBtn");
const dbListBtn = document.getElementById("dbListBtn");
const s3FileNameInput = document.getElementById("s3FileNameInput");
const s3ContentInput = document.getElementById("s3ContentInput");
const s3UploadBtn = document.getElementById("s3UploadBtn");
const s3ListBtn = document.getElementById("s3ListBtn");
const statusEl = document.getElementById("status");
const outputEl = document.getElementById("output");
const actionButtons = [dbCreateBtn, dbListBtn, s3UploadBtn, s3ListBtn].filter(
  Boolean,
);

function setLoading(isLoading) {
  actionButtons.forEach((button) => {
    button.disabled = isLoading;
  });
}

async function runRequest(path, options = {}) {
  setLoading(true);
  statusEl.textContent = "Consultando " + path + "...";
  outputEl.textContent = "Cargando...";

  try {
    const response = await fetch(path, options);
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
      2,
    );
  } finally {
    setLoading(false);
  }
}

dbCreateBtn.addEventListener("click", async () => {
  const noteText = dbNoteInput.value.trim();
  if (!noteText) {
    statusEl.textContent = "Ingresa una nota antes de guardar";
    return;
  }

  await runRequest("/api/db/notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ noteText }),
  });
});

dbListBtn.addEventListener("click", async () => {
  await runRequest("/api/db/notes");
});

s3UploadBtn.addEventListener("click", async () => {
  const fileName = s3FileNameInput.value.trim();
  const content = s3ContentInput.value;

  if (!fileName) {
    statusEl.textContent = "Ingresa el nombre del archivo";
    return;
  }

  if (!content.trim()) {
    statusEl.textContent = "Ingresa contenido para subir a S3";
    return;
  }

  await runRequest("/api/s3/objects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName, content }),
  });
});

s3ListBtn.addEventListener("click", async () => {
  await runRequest("/api/s3/objects?prefix=user-notes/");
});
