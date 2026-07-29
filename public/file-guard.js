if (window.location.protocol === "file:") {
  const app = document.getElementById("app");
  const routeName = document.getElementById("route-name");
  const restartButton = document.getElementById("restart-button");

  document.body.dataset.route = "home";
  if (routeName) routeName.textContent = "";
  if (restartButton) restartButton.hidden = true;
  if (app) {
    app.innerHTML =
      '<section class="screen screen--center"><div class="status-icon status-icon--error" aria-hidden="true">!</div>' +
      "<h1>アプリの ひらきかたが ちがいます</h1>" +
      '<p class="lead">スタッフに アプリを きどうしてもらってね</p>' +
      '<div class="actions"><a class="button" href="http://127.0.0.1:4310/">きどうした アプリを ひらく</a></div></section>';
  }
} else {
  const script = document.createElement("script");
  script.type = "module";
  script.src = "./app.js";
  document.body.appendChild(script);
}
