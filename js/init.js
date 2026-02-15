window.GIT_VERSION = '0f1b63c';
window.addEventListener('load', () => {
    document.getElementById('gitVersion').textContent = window.GIT_VERSION;
    new BeatCounterApp();
});
