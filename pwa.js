(function () {
  "use strict";
  const status = document.querySelector("#pwa-status");
  const install = document.querySelector("#install-app");
  let installEvent = null;
  function message(text, error = false) {
    status.textContent = text;
    status.classList.toggle("is-error", error);
  }
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    installEvent = event;
    install.hidden = false;
  });
  window.addEventListener("appinstalled", () => {
    installEvent = null;
    install.hidden = true;
    message("Application installée. Les ROM restent à sélectionner sur votre appareil.");
  });
  install.addEventListener("click", async () => {
    if (!installEvent) return;
    const event = installEvent;
    installEvent = null;
    install.hidden = true;
    try {
      await event.prompt();
      const choice = await event.userChoice;
      message(choice.outcome === "accepted" ? "Installation demandée au navigateur."
        : "Installation annulée ; le lecteur reste utilisable.");
    } catch (error) {
      message(`Installation impossible : ${error.message}`, true);
      console.error(error);
    }
  });
  if (!["http:", "https:"].includes(window.location.protocol)) {
    message("Ouverture locale : le lecteur fonctionne hors ligne, mais l’installation PWA nécessite HTTPS ou localhost.");
    return;
  }
  if (!window.isSecureContext || !("serviceWorker" in navigator)) {
    message("Installation hors ligne indisponible : utilisez HTTPS ou localhost avec un navigateur compatible.");
    return;
  }
  function updateReady() {
    message("Mise à jour prête. Sauvegardez votre partie puis fermez tous les onglets de l’application avant de la rouvrir.");
  }
  (async () => {
    try {
      message("Préparation des fichiers hors ligne… Gardez cette page ouverte et la connexion active.");
      const registration = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
      if (registration.waiting) updateReady();
      function watchWorker(worker) {
        if (!worker) return;
        function stateChanged() {
          if (worker.state === "installed" && navigator.serviceWorker.controller) updateReady();
          if (worker.state === "redundant") message("Préparation hors ligne échouée. Vérifiez la connexion puis rechargez la page.", true);
        }
        worker.addEventListener("statechange", stateChanged);
        stateChanged();
      }
      watchWorker(registration.installing);
      registration.addEventListener("updatefound", () => watchWorker(registration.installing));
      await navigator.serviceWorker.ready;
      if (!registration.waiting) message("Application prête hors ligne. Installation via le bouton proposé ou le menu du navigateur. Les ROM ne sont pas mises en cache.");
    } catch (error) {
      message(`Préparation hors ligne impossible : ${error.message}`, true);
      console.error(error);
    }
  })();
})();
