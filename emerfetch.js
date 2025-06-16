//                            __      _       _     
//   ___ _ __ ___   ___ _ __ / _| ___| |_ ___| |__  
//  / _ \ '_ ` _ \ / _ \ '__| |_ / _ \ __/ __| '_ \ 
// |  __/ | | | | |  __/ |  |  _|  __/ || (__| | | |
//  \___|_| |_| |_|\___|_|  |_|  \___|\__\___|_| |_|

// Originally written 2024 in PHP - so this is my optimized Node.js variant.

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const nodemailer = require('nodemailer');
const puppeteer = require('puppeteer');

const buildDate = '2025-06-17';

const EMAIL_TO = 'mail@ijosh.pics';
const EMAIL_FROM = 'emerfetch@ijosh.pics';
const LOCAL_ENVELOPE_FROM = 'emerfetch@ijosh.pics';

const transporter = nodemailer.createTransport({
  sendmail: true,
  newline: 'unix',
  path: '/usr/sbin/sendmail'
});

const sendEmail = async (site, obj) => {
  const subject = `[EmerFetch ${site}] ${obj.headline}`;
  const message = `${obj.headline}\n\n${obj.link}`;
  const mailOptions = {
    from: EMAIL_FROM,
    to: EMAIL_TO,
    subject,
    text: message,
    envelope: { from: LOCAL_ENVELOPE_FROM, to: EMAIL_TO }
  };
  console.log(`Sending mail`);
  try {
    await transporter.sendMail(mailOptions);
    console.log(`Sent successfully`);
  } catch (error) {
    console.log(`Error sending mail`, error);
  }
};

const loadKeywords = () => {
  const filePath = path.join(__dirname, 'keywords.json');
  return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : [];
};

const loadExistingLinks = (site) => {
  const filePath = path.join(__dirname, 'logs', `${site.toLowerCase()}_links.json`);
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8');
    if (content.trim().length === 0) return [];
    try {
      return JSON.parse(content);
    } catch (err) {
      return [];
    }
  }
  return [];
};

const saveExistingLinks = (site, links) => {
  const dirPath = path.join(__dirname, 'logs');
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath);
  const filePath = path.join(dirPath, `${site.toLowerCase()}_links.json`);
  fs.writeFileSync(filePath, JSON.stringify(links, null, 2), 'utf8');
};

const keywordMatch = (headline, keywords) => {
  return keywords.some(kw => headline.toLowerCase().includes(kw.toLowerCase()));
};

const fetchMerkur = async () => {
  const url = 'https://www.merkur.de/lokales/wolfratshausen/';
  try {
    console.log('Looking at Merkur');
    const res = await axios.get(url);
    const $ = cheerio.load(res.data);
    const headlines = [];
    $('a.id-LinkOverlay-link').each((i, el) => {
      let text = $(el).text().trim();
      let link = $(el).attr('href');
      if (link && !link.startsWith('http')) link = 'https:' + link;
      if (text && link) headlines.push({ headline: text, link });
    });
    console.log(`${headlines.length} articles found`);
    return headlines;
  } catch (error) {
    console.log('Merkurror', error);
    return [];
  }
};

const fetchAlpenwelle = async () => {
  const url = 'https://alpenwelle.de/aktuelles/regionale-nachrichten/bad-toelz-wolfratshausen';
  let browser;
  try {
    // browser = await puppeteer.launch();
    browser = await puppeteer.launch({
      executablePath: '/usr/bin/chromium-browser', // RPi fix
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    console.log('Looking at Alpenwelle');
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
    console.log('Starting dirty things to get the content');
    await new Promise(resolve => setTimeout(resolve, 5000));
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise(resolve => setTimeout(resolve, 3000));
    const headlines = await page.evaluate(() => {
      const arr = [];
      document.querySelectorAll('h2 a').forEach(el => {
        const text = el.innerText.trim();
        const link = el.href;
        if (text && link) arr.push({ headline: text, link });
      });
      if (arr.length === 0) {
        document.querySelectorAll('a').forEach(el => {
          const text = el.innerText.trim();
          const link = el.href;
          if (text.length > 20 && link && link.includes('alpenwelle.de')) {
            arr.push({ headline: text, link });
          }
        });
      }
      return arr;
    });
    console.log(`${headlines.length} articles found`);
    return headlines;
  } catch (error) {
    console.log('Alpenerror', error);
    return [];
  } finally {
    if (browser) {
      await browser.close();
    }
  }
};

const processSite = async (site, fetchFunc) => {
  console.log(`Triggering ${site}`);
  const headlines = await fetchFunc();
  const keywords = loadKeywords();
  console.log(`Checking ${keywords.length} keywords`);
  const existingLinks = loadExistingLinks(site);
  console.log(`Allready known articles: ${existingLinks.length}`);
  const currentLinks = headlines.map(obj => obj.link);
  let filteredLinks = existingLinks.filter(link => currentLinks.includes(link));
  for (const obj of headlines) {
    if (!filteredLinks.includes(obj.link)) {
      if (keywordMatch(obj.headline, keywords)) {
        console.log(`Keyword match: "${obj.headline}"`);
        await sendEmail(site, obj);
        await new Promise(r => setTimeout(r, 2000));
      }
      filteredLinks.push(obj.link);
    }
  }
  saveExistingLinks(site, filteredLinks);
  console.log(`${site} done`);
};

const main = async () => {
  console.log('Welcome to');
  console.log(`
                           __      _       _     
  ___ _ __ ___   ___ _ __ / _| ___| |_ ___| |__  
 / _ \\ '_ \\ _ \\ / _ \\ '__| |_ / _ \\ __/ __| '_ \\ 
|  __/ | | | | |  __/ |  |  _|  __/ || (__| | | |
 \\___|_| |_| |_|\\___|_|  |_|  \\___|\\__\\___|_| |_|
`);
  console.log('Build', buildDate, '| https://github.com/jhodevstuff\r\n\n');
  await processSite('Merkur', fetchMerkur);
  await processSite('Alpenwelle', fetchAlpenwelle);
  console.log('Job done - bye');
};

main();
