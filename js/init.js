window.GIT_VERSION = '045cc06';
window.addEventListener('load', () => {
    document.getElementById('gitVersion').textContent = window.GIT_VERSION;
    new BeatCounterApp();
});
