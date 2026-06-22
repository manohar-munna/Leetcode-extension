document.addEventListener('DOMContentLoaded', () => {
  const tokenInput = document.getElementById('token');
  const usernameInput = document.getElementById('username');
  const repoInput = document.getElementById('repo');
  const saveBtn = document.getElementById('save');
  const statusDiv = document.getElementById('status');

  // Load saved data
  chrome.storage.local.get(['githubToken', 'githubUsername', 'githubRepo'], (res) => {
    if (res.githubToken) tokenInput.value = res.githubToken;
    if (res.githubUsername) usernameInput.value = res.githubUsername;
    if (res.githubRepo) repoInput.value = res.githubRepo;
  });

  saveBtn.addEventListener('click', () => {
    const data = {
      githubToken: tokenInput.value.trim(),
      githubUsername: usernameInput.value.trim(),
      githubRepo: repoInput.value.trim()
    };

    chrome.storage.local.set(data, () => {
      statusDiv.style.display = 'block';
      setTimeout(() => {
        statusDiv.style.display = 'none';
      }, 2000);
    });
  });
});
