/* Local Ollama chat helper. Talks only to the endpoint the user sets. */
export function ollamaChat(endpoint, model, messages) {
  return fetch(endpoint + "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: model, stream: false, messages: messages })
  }).then(function(res) {
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }).then(function(data) {
    return ((data && data.message && data.message.content) || "").trim();
  }).catch(function(err) {
    var msg = String((err && err.message) || err);
    if (msg.indexOf("Failed to fetch") !== -1 || msg.indexOf("NetworkError") !== -1) {
      msg = "Ollama not reachable — run `ollama serve` on this machine.";
    } else if (msg.indexOf("404") !== -1) {
      msg += " — pull the model first: `ollama pull " + model + "`";
    }
    throw new Error(msg);
  });
}
