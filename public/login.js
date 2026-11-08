const form = document.getElementById('login-form');
const error = document.getElementById('login-error');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  error.textContent = '';
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'social-poster' },
      body: JSON.stringify({ password: document.getElementById('password').value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Login failed.');
    location.href = '/';
  } catch (err) {
    error.textContent = err.message;
    button.disabled = false;
  }
});
