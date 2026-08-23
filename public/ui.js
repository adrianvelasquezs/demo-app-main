const dbNoteInput = document.getElementById("dbNoteInput");
const dbCreateBtn = document.getElementById("dbCreateBtn");
const dbListBtn = document.getElementById("dbListBtn");
const dbPrevBtn = document.getElementById("dbPrevBtn");
const dbNextBtn = document.getElementById("dbNextBtn");
const dbPageInfo = document.getElementById("dbPageInfo");
const dbListBody = document.getElementById("dbListBody");
const s3FileNameInput = document.getElementById("s3FileNameInput");
const s3ContentInput = document.getElementById("s3ContentInput");
const s3UploadBtn = document.getElementById("s3UploadBtn");
const s3ListBtn = document.getElementById("s3ListBtn");
const s3PrevBtn = document.getElementById("s3PrevBtn");
const s3NextBtn = document.getElementById("s3NextBtn");
const s3PageInfo = document.getElementById("s3PageInfo");
const s3List = document.getElementById("s3List");
const statusEl = document.getElementById("status");
const outputEl = document.getElementById("output");
const actionButtons = [
  dbCreateBtn,
  dbListBtn,
  dbPrevBtn,
  dbNextBtn,
  s3UploadBtn,
  s3ListBtn,
  s3PrevBtn,
  s3NextBtn,
].filter(Boolean);

let dbPage = 1;
let dbTotalPages = 1;

const s3Prefix = "user-notes/";
const s3PageTokens = [null];
let s3PageIndex = 0;
let s3NextToken = null;

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
    return { response, data };
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
    return null;
  } finally {
    setLoading(false);
  }
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("es-ES");
}

function formatBytes(bytes) {
  if (typeof bytes !== "number" || Number.isNaN(bytes)) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderDbNotes(notes) {
  dbListBody.innerHTML = "";

  if (!Array.isArray(notes) || notes.length === 0) {
    const row = document.createElement("tr");
    row.innerHTML =
      '<td colspan="3" class="empty">No hay notas en esta pagina.</td>';
    dbListBody.appendChild(row);
    return;
  }

  notes.forEach((note) => {
    const row = document.createElement("tr");

    const idCell = document.createElement("td");
    idCell.textContent = String(note.id ?? "-");

    const textCell = document.createElement("td");
    textCell.textContent = String(note.note_text ?? "");

    const dateCell = document.createElement("td");
    dateCell.textContent = formatDate(note.created_at);

    row.appendChild(idCell);
    row.appendChild(textCell);
    row.appendChild(dateCell);
    dbListBody.appendChild(row);
  });
}

function updateDbPager() {
  dbPageInfo.textContent = `Pagina ${dbPage} de ${dbTotalPages}`;
  dbPrevBtn.disabled = dbPage <= 1;
  dbNextBtn.disabled = dbPage >= dbTotalPages;
}

async function loadDbPage(page) {
  const targetPage = Math.max(page, 1);
  const result = await runRequest(`/api/db/notes?page=${targetPage}`);
  if (!result) return;

  const pagination = result.data?.pagination || {};
  dbPage = Number(pagination.page || targetPage);
  dbTotalPages = Number(pagination.total_pages || 1);
  renderDbNotes(result.data?.notes || []);
  updateDbPager();
}

function renderS3Objects(objects) {
  s3List.innerHTML = "";

  if (!Array.isArray(objects) || objects.length === 0) {
    const emptyItem = document.createElement("li");
    emptyItem.className = "empty";
    emptyItem.textContent = "No hay objetos en esta pagina.";
    s3List.appendChild(emptyItem);
    return;
  }

  objects.forEach((obj) => {
    const item = document.createElement("li");
    item.className = "object-item";

    const key = document.createElement("div");
    key.className = "object-key";
    key.textContent = obj.key || "-";

    const meta = document.createElement("div");
    meta.className = "object-meta";
    meta.textContent = `${formatBytes(obj.size)} - ${formatDate(obj.last_modified)}`;

    item.appendChild(key);
    item.appendChild(meta);
    s3List.appendChild(item);
  });
}

function updateS3Pager() {
  s3PageInfo.textContent = `Pagina ${s3PageIndex + 1}`;
  s3PrevBtn.disabled = s3PageIndex === 0;
  s3NextBtn.disabled = !s3NextToken;
}

async function loadS3CurrentPage() {
  const token = s3PageTokens[s3PageIndex];
  const params = new URLSearchParams({ prefix: s3Prefix });
  if (token) params.set("continuationToken", token);

  const result = await runRequest(`/api/s3/objects?${params.toString()}`);
  if (!result) return;

  const pagination = result.data?.pagination || {};
  s3NextToken = pagination.next_continuation_token || null;

  renderS3Objects(result.data?.objects || []);
  updateS3Pager();
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

  dbNoteInput.value = "";
  await loadDbPage(1);
});

dbListBtn.addEventListener("click", async () => {
  await loadDbPage(dbPage);
});

dbPrevBtn.addEventListener("click", async () => {
  if (dbPage > 1) {
    await loadDbPage(dbPage - 1);
  }
});

dbNextBtn.addEventListener("click", async () => {
  if (dbPage < dbTotalPages) {
    await loadDbPage(dbPage + 1);
  }
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

  s3FileNameInput.value = "";
  s3ContentInput.value = "";
  s3PageTokens.length = 1;
  s3PageTokens[0] = null;
  s3PageIndex = 0;
  await loadS3CurrentPage();
});

s3ListBtn.addEventListener("click", async () => {
  s3PageTokens.length = 1;
  s3PageTokens[0] = null;
  s3PageIndex = 0;
  await loadS3CurrentPage();
});

s3PrevBtn.addEventListener("click", async () => {
  if (s3PageIndex > 0) {
    s3PageIndex -= 1;
    await loadS3CurrentPage();
  }
});

s3NextBtn.addEventListener("click", async () => {
  if (!s3NextToken) return;

  if (s3PageIndex === s3PageTokens.length - 1) {
    s3PageTokens.push(s3NextToken);
  }

  s3PageIndex += 1;
  await loadS3CurrentPage();
});

updateDbPager();
updateS3Pager();
