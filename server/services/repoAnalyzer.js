/**
 * repoAnalyzer.js
 *
 * Pure static analysis of a public GitHub repository via the REST API v3.
 * No authentication required for public repos (60 req/hr limit).
 *
 * Returns:
 *   {
 *     techStack:  [{ name, confidence, evidence }],
 *     objectives: [{ label, confidence, evidence }],
 *     repoMeta:   { description, topics, stars, language }
 *   }
 */

import axios from 'axios';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse github.com/{owner}/{repo} or git@github.com:{owner}/{repo}.git
 * Returns { owner, repo } or null.
 */
export function parseGithubUrl(url) {
  try {
    const cleaned = url.trim().replace(/\.git$/, '');
    // HTTPS form: https://github.com/owner/repo
    const httpsMatch = cleaned.match(/github\.com[/:]([\w.-]+)\/([\w.-]+)/);
    if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };
    return null;
  } catch {
    return null;
  }
}

const GH = 'https://api.github.com';

async function ghGet(path) {
  const res = await axios.get(`${GH}${path}`, {
    timeout: 8000,
    headers: {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'Acadova-RepoAnalyzer/1.0',
    },
  });
  return res.data;
}

async function fetchTextFile(owner, repo, filename) {
  try {
    const data = await ghGet(`/repos/${owner}/${repo}/contents/${filename}`);
    if (data.encoding === 'base64') {
      return Buffer.from(data.content, 'base64').toString('utf8');
    }
    return null;
  } catch {
    return null;
  }
}

// ── Tech Stack Detection ──────────────────────────────────────────────────────

const LANG_MAP = {
  JavaScript: { name: 'JavaScript', confidence: 'high', category: 'frontend' },
  TypeScript: { name: 'TypeScript', confidence: 'high', category: 'frontend' },
  Python: { name: 'Python', confidence: 'high', category: 'backend' },
  Java: { name: 'Java', confidence: 'high', category: 'backend' },
  Go: { name: 'Go', confidence: 'high', category: 'backend' },
  Rust: { name: 'Rust', confidence: 'high', category: 'backend' },
  'C++': { name: 'C++', confidence: 'high', category: 'backend' },
  C: { name: 'C', confidence: 'high', category: 'backend' },
  'C#': { name: 'C#', confidence: 'high', category: 'backend' },
  Ruby: { name: 'Ruby', confidence: 'high', category: 'backend' },
  Kotlin: { name: 'Kotlin', confidence: 'high', category: 'backend' },
  Swift: { name: 'Swift', confidence: 'high', category: 'frontend' },
  PHP: { name: 'PHP', confidence: 'high', category: 'backend' },
  Dart: { name: 'Dart', confidence: 'high', category: 'frontend' },
  HTML: { name: 'HTML/CSS', confidence: 'medium', category: 'frontend' },
  CSS: { name: 'HTML/CSS', confidence: 'medium', category: 'frontend' },
  Shell: { name: 'Shell / Bash', confidence: 'low', category: 'tools' },
  Dockerfile: { name: 'Docker', confidence: 'high', category: 'tools' },
  Scala: { name: 'Scala', confidence: 'high', category: 'backend' },
  Elixir: { name: 'Elixir', confidence: 'high', category: 'backend' },
  Clojure: { name: 'Clojure', confidence: 'high', category: 'backend' },
  Haskell: { name: 'Haskell', confidence: 'high', category: 'backend' },
  Erlang: { name: 'Erlang', confidence: 'high', category: 'backend' },
  Lua: { name: 'Lua', confidence: 'high', category: 'backend' },
  R: { name: 'R', confidence: 'high', category: 'backend' },
  'Objective-C': { name: 'Objective-C', confidence: 'high', category: 'frontend' },
  Vue: { name: 'Vue.js', confidence: 'high', category: 'frontend' },
  Svelte: { name: 'Svelte', confidence: 'high', category: 'frontend' },
};


// dependencies in package.json → framework name
const NPM_FRAMEWORK_MAP = {
  react: { name: 'React', confidence: 'high', category: 'frontend' },
  'react-dom': { name: 'React', confidence: 'high', category: 'frontend' },
  next: { name: 'Next.js', confidence: 'high', category: 'frontend' },
  vue: { name: 'Vue.js', confidence: 'high', category: 'frontend' },
  nuxt: { name: 'Nuxt.js', confidence: 'high', category: 'frontend' },
  '@angular/core': { name: 'Angular', confidence: 'high', category: 'frontend' },
  svelte: { name: 'Svelte', confidence: 'high', category: 'frontend' },
  express: { name: 'Express.js', confidence: 'high', category: 'backend' },
  fastify: { name: 'Fastify', confidence: 'high', category: 'backend' },
  koa: { name: 'Koa', confidence: 'high', category: 'backend' },
  '@nestjs/core': { name: 'NestJS', confidence: 'high', category: 'backend' },
  mongoose: { name: 'MongoDB / Mongoose', confidence: 'high', category: 'database' },
  mongodb: { name: 'MongoDB', confidence: 'high', category: 'database' },
  sequelize: { name: 'Sequelize (SQL)', confidence: 'high', category: 'database' },
  prisma: { name: 'Prisma ORM', confidence: 'high', category: 'database' },
  typeorm: { name: 'TypeORM', confidence: 'high', category: 'database' },
  pg: { name: 'PostgreSQL', confidence: 'high', category: 'database' },
  mysql2: { name: 'MySQL', confidence: 'high', category: 'database' },
  redis: { name: 'Redis', confidence: 'high', category: 'database' },
  ioredis: { name: 'Redis (ioredis)', confidence: 'high', category: 'database' },
  socket: { name: 'WebSockets / Socket.io', confidence: 'high', category: 'backend' },
  'socket.io': { name: 'WebSockets / Socket.io', confidence: 'high', category: 'backend' },
  pusher: { name: 'Pusher (Real-time)', confidence: 'high', category: 'backend' },
  graphql: { name: 'GraphQL', confidence: 'high', category: 'backend' },
  '@apollo/client': { name: 'Apollo GraphQL', confidence: 'high', category: 'frontend' },
  'graphql-request': { name: 'GraphQL Request', confidence: 'medium', category: 'frontend' },
  axios: { name: 'REST API client (Axios)', confidence: 'medium', category: 'tools' },
  vite: { name: 'Vite', confidence: 'high', category: 'tools' },
  webpack: { name: 'Webpack', confidence: 'medium', category: 'tools' },
  tailwindcss: { name: 'Tailwind CSS', confidence: 'high', category: 'frontend' },
  '@mui/material': { name: 'Material UI (MUI)', confidence: 'high', category: 'frontend' },
  '@chakra-ui/react': { name: 'Chakra UI', confidence: 'high', category: 'frontend' },
  antd: { name: 'Ant Design', confidence: 'high', category: 'frontend' },
  'styled-components': { name: 'Styled Components', confidence: 'high', category: 'frontend' },
  sass: { name: 'Sass / SCSS', confidence: 'high', category: 'frontend' },
  zustand: { name: 'Zustand (State Mgt)', confidence: 'high', category: 'frontend' },
  redux: { name: 'Redux', confidence: 'high', category: 'frontend' },
  '@reduxjs/toolkit': { name: 'Redux Toolkit', confidence: 'high', category: 'frontend' },
  'react-query': { name: 'React Query', confidence: 'high', category: 'frontend' },
  '@tanstack/react-query': { name: 'TanStack Query', confidence: 'high', category: 'frontend' },
  'framer-motion': { name: 'Framer Motion (Animations)', confidence: 'high', category: 'frontend' },
  jest: { name: 'Jest (testing)', confidence: 'medium', category: 'tools' },
  vitest: { name: 'Vitest (testing)', confidence: 'medium', category: 'tools' },
  cypress: { name: 'Cypress (E2E testing)', confidence: 'high', category: 'tools' },
  playwright: { name: 'Playwright (E2E testing)', confidence: 'high', category: 'tools' },
  '@testing-library/react': { name: 'React Testing Library', confidence: 'medium', category: 'tools' },
  storybook: { name: 'Storybook', confidence: 'high', category: 'tools' },
  electron: { name: 'Electron (desktop)', confidence: 'high', category: 'frontend' },
  'react-native': { name: 'React Native', confidence: 'high', category: 'frontend' },
  expo: { name: 'Expo (React Native)', confidence: 'high', category: 'frontend' },
  openai: { name: 'OpenAI API', confidence: 'high', category: 'tools' },
  '@tensorflow/tfjs': { name: 'TensorFlow.js', confidence: 'high', category: 'tools' },
  firebase: { name: 'Firebase', confidence: 'high', category: 'backend' },
  'firebase-admin': { name: 'Firebase Admin', confidence: 'high', category: 'backend' },
  '@supabase/supabase-js': { name: 'Supabase', confidence: 'high', category: 'backend' },
  stripe: { name: 'Stripe (payments)', confidence: 'high', category: 'backend' },
  jsonwebtoken: { name: 'JWT Authentication', confidence: 'high', category: 'backend' },
  passport: { name: 'Passport.js (auth)', confidence: 'high', category: 'backend' },
  bcrypt: { name: 'bcrypt (password hashing)', confidence: 'high', category: 'backend' },
  bcryptjs: { name: 'bcrypt (password hashing)', confidence: 'high', category: 'backend' },
  dotenv: { name: 'Environment config', confidence: 'low', category: 'tools' },
  nodemailer: { name: 'Email (Nodemailer)', confidence: 'high', category: 'backend' },
  pdfkit: { name: 'PDF generation', confidence: 'high', category: 'tools' },
  sharp: { name: 'Image processing (Sharp)', confidence: 'high', category: 'tools' },
  multer: { name: 'File uploads (Multer)', confidence: 'high', category: 'backend' },
  'aws-sdk': { name: 'AWS SDK', confidence: 'high', category: 'backend' },
  '@aws-sdk/client-s3': { name: 'AWS S3', confidence: 'high', category: 'backend' },
  recharts: { name: 'Recharts (data viz)', confidence: 'medium', category: 'frontend' },
  'chart.js': { name: 'Chart.js', confidence: 'medium', category: 'frontend' },
  d3: { name: 'D3.js (data viz)', confidence: 'high', category: 'frontend' },
  three: { name: 'Three.js (3D)', confidence: 'high', category: 'frontend' },
  zod: { name: 'Zod (Validation)', confidence: 'high', category: 'tools' },
  yup: { name: 'Yup (Validation)', confidence: 'high', category: 'tools' },
  'react-hook-form': { name: 'React Hook Form', confidence: 'high', category: 'frontend' },
  formik: { name: 'Formik', confidence: 'high', category: 'frontend' },
  'date-fns': { name: 'date-fns', confidence: 'medium', category: 'tools' },
  lodash: { name: 'Lodash', confidence: 'medium', category: 'tools' },
  winston: { name: 'Winston (Logging)', confidence: 'high', category: 'backend' },
  helmet: { name: 'Helmet (Security)', confidence: 'high', category: 'backend' },
  bull: { name: 'Bull (Task Queue)', confidence: 'high', category: 'backend' },
  kafkajs: { name: 'Apache Kafka', confidence: 'high', category: 'backend' },
  rxjs: { name: 'RxJS', confidence: 'high', category: 'tools' },
};


// Python requirements → framework name
const PY_PACKAGE_MAP = {
  fastapi: { name: 'FastAPI', confidence: 'high', category: 'backend' },
  flask: { name: 'Flask', confidence: 'high', category: 'backend' },
  django: { name: 'Django', confidence: 'high', category: 'backend' },
  'django-rest-framework': { name: 'Django REST Framework', confidence: 'high', category: 'backend' },
  tornado: { name: 'Tornado', confidence: 'high', category: 'backend' },
  aiohttp: { name: 'aiohttp', confidence: 'high', category: 'backend' },
  httpx: { name: 'HTTPX', confidence: 'medium', category: 'tools' },
  requests: { name: 'Requests', confidence: 'medium', category: 'tools' },
  sqlalchemy: { name: 'SQLAlchemy (ORM)', confidence: 'high', category: 'database' },
  alembic: { name: 'Alembic (Migrations)', confidence: 'high', category: 'database' },
  pymongo: { name: 'MongoDB (PyMongo)', confidence: 'high', category: 'database' },
  motor: { name: 'MongoDB (Motor async)', confidence: 'high', category: 'database' },
  psycopg2: { name: 'PostgreSQL (psycopg2)', confidence: 'high', category: 'database' },
  pymysql: { name: 'MySQL (PyMySQL)', confidence: 'high', category: 'database' },
  pandas: { name: 'Pandas (data analysis)', confidence: 'high', category: 'tools' },
  numpy: { name: 'NumPy', confidence: 'high', category: 'tools' },
  scikit_learn: { name: 'Scikit-learn (ML)', confidence: 'high', category: 'tools' },
  'scikit-learn': { name: 'Scikit-learn (ML)', confidence: 'high', category: 'tools' },
  tensorflow: { name: 'TensorFlow', confidence: 'high', category: 'tools' },
  torch: { name: 'PyTorch', confidence: 'high', category: 'tools' },
  transformers: { name: 'HuggingFace Transformers', confidence: 'high', category: 'tools' },
  nltk: { name: 'NLTK (NLP)', confidence: 'high', category: 'tools' },
  spacy: { name: 'spaCy (NLP)', confidence: 'high', category: 'tools' },
  'opencv-python': { name: 'OpenCV (Computer Vision)', confidence: 'high', category: 'tools' },
  matplotlib: { name: 'Matplotlib (Data Viz)', confidence: 'high', category: 'tools' },
  seaborn: { name: 'Seaborn (Data Viz)', confidence: 'high', category: 'tools' },
  plotly: { name: 'Plotly (Data Viz)', confidence: 'high', category: 'tools' },
  openai: { name: 'OpenAI API', confidence: 'high', category: 'tools' },
  langchain: { name: 'LangChain', confidence: 'high', category: 'tools' },
  celery: { name: 'Celery (task queue)', confidence: 'high', category: 'backend' },
  redis: { name: 'Redis', confidence: 'high', category: 'database' },
  boto3: { name: 'AWS SDK (boto3)', confidence: 'high', category: 'backend' },
  pydantic: { name: 'Pydantic', confidence: 'medium', category: 'tools' },
  uvicorn: { name: 'Uvicorn (ASGI)', confidence: 'medium', category: 'backend' },
  gunicorn: { name: 'Gunicorn (WSGI)', confidence: 'medium', category: 'backend' },
  pytest: { name: 'Pytest (testing)', confidence: 'medium', category: 'tools' },
  'pytest-cov': { name: 'Pytest Coverage', confidence: 'medium', category: 'tools' },
  black: { name: 'Black (Formatter)', confidence: 'medium', category: 'tools' },
  flake8: { name: 'Flake8 (Linter)', confidence: 'medium', category: 'tools' },
  mypy: { name: 'Mypy (Type Checker)', confidence: 'medium', category: 'tools' },
  pillow: { name: 'Pillow (image processing)', confidence: 'medium', category: 'tools' },
  streamlit: { name: 'Streamlit (ML UI)', confidence: 'high', category: 'frontend' },
  gradio: { name: 'Gradio (ML UI)', confidence: 'high', category: 'frontend' },
  jupyter: { name: 'Jupyter Notebooks', confidence: 'high', category: 'tools' },
  beautifulsoup4: { name: 'BeautifulSoup (Scraping)', confidence: 'high', category: 'tools' },
  scrapy: { name: 'Scrapy', confidence: 'high', category: 'tools' },
  stripe: { name: 'Stripe (payments)', confidence: 'high', category: 'backend' },
};


// Root file presence → tech
const ROOT_FILE_MAP = {
  'docker-compose.yml': { name: 'Docker Compose', confidence: 'high', evidence: 'docker-compose.yml', category: 'tools' },
  'docker-compose.yaml': { name: 'Docker Compose', confidence: 'high', evidence: 'docker-compose.yaml', category: 'tools' },
  Dockerfile: { name: 'Docker', confidence: 'high', evidence: 'Dockerfile', category: 'tools' },
  'kubernetes.yml': { name: 'Kubernetes', confidence: 'high', evidence: 'kubernetes.yml', category: 'tools' },
  '.github': { name: 'GitHub Actions (CI/CD)', confidence: 'medium', evidence: '.github workflows', category: 'tools' },
  '.gitlab-ci.yml': { name: 'GitLab CI', confidence: 'high', evidence: '.gitlab-ci.yml', category: 'tools' },
  'bitbucket-pipelines.yml': { name: 'Bitbucket Pipelines', confidence: 'high', evidence: 'bitbucket-pipelines.yml', category: 'tools' },
  Jenkinsfile: { name: 'Jenkins', confidence: 'high', evidence: 'Jenkinsfile', category: 'tools' },
  'terraform.tf': { name: 'Terraform (IaC)', confidence: 'high', evidence: 'terraform.tf', category: 'tools' },
  'vercel.json': { name: 'Vercel deployment', confidence: 'high', evidence: 'vercel.json', category: 'tools' },
  'netlify.toml': { name: 'Netlify deployment', confidence: 'high', evidence: 'netlify.toml', category: 'tools' },
  'go.mod': { name: 'Go modules', confidence: 'high', evidence: 'go.mod', category: 'backend' },
  'Cargo.toml': { name: 'Rust / Cargo', confidence: 'high', evidence: 'Cargo.toml', category: 'backend' },
  'pom.xml': { name: 'Maven (Java)', confidence: 'high', evidence: 'pom.xml', category: 'backend' },
  'build.gradle': { name: 'Gradle (Java/Kotlin)', confidence: 'high', evidence: 'build.gradle', category: 'backend' },
  'pubspec.yaml': { name: 'Flutter / Dart', confidence: 'high', evidence: 'pubspec.yaml', category: 'frontend' },
  Gemfile: { name: 'Ruby / Bundler', confidence: 'high', evidence: 'Gemfile', category: 'backend' },
  'mix.exs': { name: 'Elixir / Phoenix', confidence: 'high', evidence: 'mix.exs', category: 'backend' },
  'composer.json': { name: 'PHP / Composer', confidence: 'high', evidence: 'composer.json', category: 'backend' },
  'tsconfig.json': { name: 'TypeScript', confidence: 'high', evidence: 'tsconfig.json', category: 'frontend' },
  'tailwind.config.js': { name: 'Tailwind CSS', confidence: 'high', evidence: 'tailwind.config.js', category: 'frontend' },
  'vite.config.js': { name: 'Vite', confidence: 'high', evidence: 'vite.config.js', category: 'tools' },
  'vite.config.ts': { name: 'Vite', confidence: 'high', evidence: 'vite.config.ts', category: 'tools' },
  'webpack.config.js': { name: 'Webpack', confidence: 'high', evidence: 'webpack.config.js', category: 'tools' },
  'next.config.js': { name: 'Next.js', confidence: 'high', evidence: 'next.config.js', category: 'frontend' },
  '.eslintrc.js': { name: 'ESLint', confidence: 'high', evidence: '.eslintrc.js', category: 'tools' },
  '.eslintrc.json': { name: 'ESLint', confidence: 'high', evidence: '.eslintrc.json', category: 'tools' },
  '.prettierrc': { name: 'Prettier', confidence: 'high', evidence: '.prettierrc', category: 'tools' },
  'jest.config.js': { name: 'Jest', confidence: 'high', evidence: 'jest.config.js', category: 'tools' },
  Makefile: { name: 'Make', confidence: 'medium', evidence: 'Makefile', category: 'tools' },
  Procfile: { name: 'Heroku / Foreman', confidence: 'high', evidence: 'Procfile', category: 'tools' },
  Vagrantfile: { name: 'Vagrant', confidence: 'high', evidence: 'Vagrantfile', category: 'tools' },
  '.env.example': { name: 'Environment config', confidence: 'low', evidence: '.env.example', category: 'tools' },
  'nginx.conf': { name: 'NGINX', confidence: 'high', evidence: 'nginx.conf', category: 'tools' },
};


// ── Main Analyzer ─────────────────────────────────────────────────────────────

export async function analyzeRepo(githubUrl) {
  const parsed = parseGithubUrl(githubUrl);
  if (!parsed) throw new Error('Invalid GitHub URL. Use https://github.com/owner/repo');

  const { owner, repo } = parsed;

  // Fetch in parallel: repo meta, languages, root contents
  const [repoData, languages, contents] = await Promise.all([
    ghGet(`/repos/${owner}/${repo}`),
    ghGet(`/repos/${owner}/${repo}/languages`),
    ghGet(`/repos/${owner}/${repo}/contents`).catch(() => []),
  ]);

  const rootFiles = Array.isArray(contents) ? contents.map((f) => f.name) : [];

  // Selectively fetch manifest files
  const manifests = await Promise.all([
    rootFiles.includes('package.json') ? fetchTextFile(owner, repo, 'package.json') : null,
    rootFiles.includes('requirements.txt') ? fetchTextFile(owner, repo, 'requirements.txt') : null,
    rootFiles.includes('pyproject.toml') ? fetchTextFile(owner, repo, 'pyproject.toml') : null,
    rootFiles.includes('README.md') ? fetchTextFile(owner, repo, 'README.md') : null,
    rootFiles.includes('readme.md') ? fetchTextFile(owner, repo, 'readme.md') : null,
  ]);

  const [packageJson, requirementsTxt, pyprojectToml, readmeMd, readmeMdLower] = manifests;
  const readmeText = readmeMd || readmeMdLower || '';

  const techMap = new Map(); // name → { confidence, evidence, category } (deduplicated)

  const add = (name, confidence, evidence, category = 'tools') => {
    if (!techMap.has(name) || confidence === 'high') {
      techMap.set(name, { confidence, evidence, category });
    }
  };

  // 1. Languages (sorted by byte count, take top 5)
  const sortedLangs = Object.entries(languages).sort(([, a], [, b]) => b - a).slice(0, 5);
  for (const [lang] of sortedLangs) {
    const mapped = LANG_MAP[lang];
    if (mapped) add(mapped.name, mapped.confidence, `Detected in repository language stats (${lang})`, mapped.category);
  }

  // 2. npm dependencies (package.json)
  if (packageJson) {
    try {
      const pkg = JSON.parse(packageJson);
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };
      for (const [dep, mapped] of Object.entries(NPM_FRAMEWORK_MAP)) {
        if (allDeps[dep]) {
          add(mapped.name, mapped.confidence, `Found "${dep}" in package.json dependencies`, mapped.category);
        }
      }
    } catch { /* malformed JSON — skip */ }
  }

  // 3. Python packages (requirements.txt)
  if (requirementsTxt) {
    const lines = requirementsTxt.split('\n').map((l) => l.trim().toLowerCase().split(/[>=<!~]/)[0]);
    for (const [pkg, mapped] of Object.entries(PY_PACKAGE_MAP)) {
      if (lines.some((l) => l === pkg || l === pkg.replace(/_/g, '-'))) {
        add(mapped.name, mapped.confidence, `Found "${pkg}" in requirements.txt`, mapped.category);
      }
    }
  }

  // 4. pyproject.toml (also covers Poetry / setuptools)
  if (pyprojectToml) {
    const lc = pyprojectToml.toLowerCase();
    for (const [pkg, mapped] of Object.entries(PY_PACKAGE_MAP)) {
      if (lc.includes(pkg.toLowerCase())) {
        add(mapped.name, mapped.confidence, `Found "${pkg}" in pyproject.toml`, mapped.category);
      }
    }
  }

  // 5. Root file presence
  for (const [filename, entry] of Object.entries(ROOT_FILE_MAP)) {
    if (rootFiles.includes(filename)) {
      add(entry.name, entry.confidence, `Found ${entry.evidence} in repository root`, entry.category);
    }
  }

  // 6. Repo topics (e.g. "react", "fastapi")
  const topics = repoData.topics || [];
  for (const topic of topics) {
    // match against npm map keys
    const npmHit = NPM_FRAMEWORK_MAP[topic];
    if (npmHit) add(npmHit.name, 'medium', `Repository topic: "${topic}"`, npmHit.category);
    const pyHit = PY_PACKAGE_MAP[topic];
    if (pyHit) add(pyHit.name, 'medium', `Repository topic: "${topic}"`, pyHit.category);
  }

  // 7. README keyword scanning (low confidence — fills gaps when no manifests exist)
  // Maps commonly mentioned tech keywords in README prose to their stack entries.
  if (readmeText) {
    const README_KEYWORD_MAP = [
      // Frontend frameworks
      { pattern: /\b(react\.?js|reactjs)\b/i,    name: 'React',           category: 'frontend' },
      { pattern: /\bvue\.?js\b/i,                name: 'Vue.js',          category: 'frontend' },
      { pattern: /\bangular\b/i,                 name: 'Angular',         category: 'frontend' },
      { pattern: /\bsvelte\b/i,                  name: 'Svelte',          category: 'frontend' },
      { pattern: /\bnext\.?js\b/i,               name: 'Next.js',         category: 'frontend' },
      { pattern: /\bnuxt\.?js\b/i,               name: 'Nuxt.js',         category: 'frontend' },
      { pattern: /\btailwind(?: css)?\b/i,       name: 'Tailwind CSS',    category: 'frontend' },
      { pattern: /\bbootstrap\b/i,               name: 'Bootstrap',       category: 'frontend' },
      { pattern: /\bmaterial.?ui|mui\b/i,        name: 'Material UI (MUI)',category: 'frontend' },
      { pattern: /\bchakra.?ui\b/i,              name: 'Chakra UI',       category: 'frontend' },
      { pattern: /\bthree\.?js\b/i,              name: 'Three.js (3D)',   category: 'frontend' },
      { pattern: /\belectron\b/i,                name: 'Electron (desktop)', category: 'frontend' },
      { pattern: /\breact.?native\b/i,           name: 'React Native',    category: 'frontend' },
      { pattern: /\bflutter\b/i,                 name: 'Flutter / Dart',  category: 'frontend' },
      { pattern: /\bstreamlit\b/i,               name: 'Streamlit (ML UI)', category: 'frontend' },
      { pattern: /\bgradio\b/i,                  name: 'Gradio (ML UI)',  category: 'frontend' },

      // Backend frameworks
      { pattern: /\bexpress\.?js\b/i,            name: 'Express.js',      category: 'backend' },
      { pattern: /\bfastapi\b/i,                 name: 'FastAPI',         category: 'backend' },
      { pattern: /\bflask\b/i,                   name: 'Flask',           category: 'backend' },
      { pattern: /\bdjango\b/i,                  name: 'Django',          category: 'backend' },
      { pattern: /\bnest\.?js\b/i,               name: 'NestJS',          category: 'backend' },
      { pattern: /\bfastify\b/i,                 name: 'Fastify',         category: 'backend' },
      { pattern: /\bspring boot\b/i,             name: 'Spring Boot',     category: 'backend' },
      { pattern: /\bruby on rails\b/i,           name: 'Ruby on Rails',   category: 'backend' },
      { pattern: /\blaravel\b/i,                 name: 'Laravel (PHP)',   category: 'backend' },
      { pattern: /\bginb?\b/i,                   name: 'Gin (Go)',        category: 'backend' },
      { pattern: /\bfastify\b/i,                 name: 'Fastify',         category: 'backend' },
      { pattern: /\bgraphql\b/i,                 name: 'GraphQL',         category: 'backend' },
      { pattern: /\brest api\b/i,                name: 'REST API',        category: 'backend' },
      { pattern: /\bsocket\.?io\b/i,             name: 'WebSockets / Socket.io', category: 'backend' },
      { pattern: /\bwebsocket\b/i,               name: 'WebSockets / Socket.io', category: 'backend' },
      { pattern: /\bsupabase\b/i,                name: 'Supabase',        category: 'backend' },
      { pattern: /\bfirebase\b/i,                name: 'Firebase',        category: 'backend' },
      { pattern: /\bstripe\b/i,                  name: 'Stripe (payments)', category: 'backend' },
      { pattern: /\bjwt|json web token\b/i,      name: 'JWT Authentication', category: 'backend' },

      // Databases
      { pattern: /\bmongodb\b/i,                 name: 'MongoDB',         category: 'database' },
      { pattern: /\bmongoose\b/i,                name: 'MongoDB / Mongoose', category: 'database' },
      { pattern: /\bpostgresql|postgres\b/i,     name: 'PostgreSQL',      category: 'database' },
      { pattern: /\bmysql\b/i,                   name: 'MySQL',           category: 'database' },
      { pattern: /\bsqlite\b/i,                  name: 'SQLite',          category: 'database' },
      { pattern: /\bredis\b/i,                   name: 'Redis',           category: 'database' },
      { pattern: /\belasticsearch\b/i,           name: 'Elasticsearch',   category: 'database' },
      { pattern: /\bfirestore\b/i,               name: 'Firestore',       category: 'database' },
      { pattern: /\bdynamodb\b/i,                name: 'DynamoDB (AWS)',  category: 'database' },
      { pattern: /\bsupabase\b/i,                name: 'Supabase',        category: 'database' },
      { pattern: /\bprisma\b/i,                  name: 'Prisma ORM',      category: 'database' },
      { pattern: /\bsqlalchemy\b/i,              name: 'SQLAlchemy (ORM)', category: 'database' },

      // Tools / DevOps
      { pattern: /\bdocker\b/i,                  name: 'Docker',          category: 'tools' },
      { pattern: /\bkubernetes|k8s\b/i,          name: 'Kubernetes',      category: 'tools' },
      { pattern: /\bgithub actions\b/i,          name: 'GitHub Actions (CI/CD)', category: 'tools' },
      { pattern: /\bterraform\b/i,               name: 'Terraform (IaC)', category: 'tools' },
      { pattern: /\bvercel\b/i,                  name: 'Vercel deployment', category: 'tools' },
      { pattern: /\bnetlify\b/i,                 name: 'Netlify deployment', category: 'tools' },
      { pattern: /\baws\b/i,                     name: 'AWS',             category: 'tools' },
      { pattern: /\bgoogle cloud|gcp\b/i,        name: 'Google Cloud',    category: 'tools' },
      { pattern: /\bheroku\b/i,                  name: 'Heroku',          category: 'tools' },
      { pattern: /\bnginx\b/i,                   name: 'NGINX',           category: 'tools' },
      { pattern: /\bvite\b/i,                    name: 'Vite',            category: 'tools' },
      { pattern: /\bwebpack\b/i,                 name: 'Webpack',         category: 'tools' },
      { pattern: /\bopenai\b/i,                  name: 'OpenAI API',      category: 'tools' },
      { pattern: /\blangchain\b/i,               name: 'LangChain',       category: 'tools' },
      { pattern: /\btensorflow\b/i,              name: 'TensorFlow',      category: 'tools' },
      { pattern: /\bpytorch\b/i,                 name: 'PyTorch',         category: 'tools' },
    ];

    // Only scan the first 4000 chars of the README to keep it fast and focused
    const readmeSample = readmeText.slice(0, 4000);
    for (const { pattern, name, category } of README_KEYWORD_MAP) {
      if (pattern.test(readmeSample)) {
        add(name, 'high', 'Mentioned in README', category);
      }
    }
  }

  const techStackFlat = Array.from(techMap.entries()).map(([name, data]) => ({
    name,
    ...data,
  })).sort((a, b) => (a.confidence === 'high' ? -1 : 1));

  const techStack = {
    frontend: techStackFlat.filter((t) => t.category === 'frontend'),
    backend: techStackFlat.filter((t) => t.category === 'backend'),
    database: techStackFlat.filter((t) => t.category === 'database'),
    tools: techStackFlat.filter((t) => t.category === 'tools'),
  };

  return {
    techStack,
    repoMeta: {
      name: repoData.name || repo,
      description: repoData.description || '',
      topics,
      stars: repoData.stargazers_count,
      language: repoData.language,
      isPrivate: repoData.private,
    },
  };
}
