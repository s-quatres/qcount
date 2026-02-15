window.GIT_VERSION = '019dc9f';
window.addEventListener('load', () => {
    document.getElementById('gitVersion').textContent = window.GIT_VERSION;
    new BeatCounterApp();
});
