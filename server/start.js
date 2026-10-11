import app from "./index.js";

const port = Number(process.env.API_PORT || 3002);
app.listen(port, "127.0.0.1", () =>
  console.log(`Chart AI API listening on 127.0.0.1:${port}`),
);
