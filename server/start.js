import app from "./index.js";

const port = Number(process.env.PORT || 3001);
app.listen(port, "0.0.0.0", () =>
  console.log(`Chart AI API listening on ${port}`),
);
