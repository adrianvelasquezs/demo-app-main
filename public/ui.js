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
      2,
    );
  } finally {
    setLoading(false);
  }
}

dbBtn.addEventListener("click", () => runTest("/db-test"));
s3Btn.addEventListener("click", () => runTest("/s3-test"));
