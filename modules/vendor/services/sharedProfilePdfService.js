import puppeteer from 'puppeteer';

const PROD_FRONTEND_BASE = 'https://www.caasdiglobal.in';
const DEV_FRONTEND_BASE = 'http://localhost:5173';

let browserPromise = null;

const sanitizeBaseUrl = (value) => {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().replace(/\/+$/, '');
};

const resolveFrontendBaseUrl = (requestOrigin, requestReferer) => {
  const origin = sanitizeBaseUrl(requestOrigin);
  if (origin) {
    return origin;
  }

  const referer = sanitizeBaseUrl(requestReferer);
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      // Ignore malformed referer values and continue with env/default resolution.
    }
  }

  return sanitizeBaseUrl(process.env.VENDOR_FRONTEND_URL)
    || sanitizeBaseUrl(process.env.VENDOR_DASH)
    || (process.env.NODE_ENV === 'production' ? PROD_FRONTEND_BASE : DEV_FRONTEND_BASE);
};

const buildSharedProfileUrl = ({ vendorId, requestOrigin, requestReferer, query }) => {
  const frontendBaseUrl = resolveFrontendBaseUrl(requestOrigin, requestReferer);
  const sharedProfileUrl = new URL(`${frontendBaseUrl}/shared-profile/${encodeURIComponent(vendorId)}`);

  Object.entries(query || {}).forEach(([key, value]) => {
    if (value == null) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item != null) {
          sharedProfileUrl.searchParams.append(key, String(item));
        }
      });
      return;
    }

    sharedProfileUrl.searchParams.set(key, String(value));
  });

  sharedProfileUrl.searchParams.set('render', 'pdf');
  return sharedProfileUrl.toString();
};

const launchBrowser = async () => {
  if (!browserPromise) {
    const launchOptions = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--font-render-hinting=none'
      ]
    };

    const executablePath = sanitizeBaseUrl(process.env.PUPPETEER_EXECUTABLE_PATH);
    if (executablePath) {
      launchOptions.executablePath = executablePath;
    }

    browserPromise = puppeteer.launch(launchOptions).catch((error) => {
      browserPromise = null;
      throw error;
    });
  }

  return browserPromise;
};

export const generateSharedProfilePdf = async ({ vendorId, requestOrigin, requestReferer, query }) => {
  const browser = await launchBrowser();
  const page = await browser.newPage();

  try {
    const sharedProfileUrl = buildSharedProfileUrl({
      vendorId,
      requestOrigin,
      requestReferer,
      query
    });

    await page.setViewport({ width: 1440, height: 2000, deviceScaleFactor: 1 });
    await page.goto(sharedProfileUrl, {
      waitUntil: 'networkidle2',
      timeout: 120000
    });

    await page.waitForSelector('[data-portfolio-print-page]', { timeout: 120000 });
    await page.evaluate(async () => {
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }

      const images = Array.from(document.images || []);
      await Promise.all(images.map((image) => {
        if (image.complete) {
          return Promise.resolve();
        }

        return new Promise((resolve) => {
          const done = () => resolve();
          image.addEventListener('load', done, { once: true });
          image.addEventListener('error', done, { once: true });
        });
      }));
    });

    await page.emulateMediaType('print');

    return await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: {
        top: '0mm',
        right: '0mm',
        bottom: '0mm',
        left: '0mm'
      }
    });
  } finally {
    await page.close();
  }
};