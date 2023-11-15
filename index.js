import { readFile, mkdir, access, constants } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { join } from 'path'
import { cwd } from 'process'
import { authenticate } from '@google-cloud/local-auth'
import { google } from 'googleapis'

// If modifying these scopes, delete token.json.
const SCOPES = [
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/drive.readonly'
]
const TOKEN_PATH = join(cwd(), 'token.json')
const CREDENTIALS_PATH = join(cwd(), 'credentials.json')
const DOWNLOAD_PATH = join(cwd(), 'ArchivosDrive')

/**
 * Reads previously authorized credentials from the save file.
 *
 * @return {Promise<OAuth2Client|null>}
 */
async function loadSavedCredentialsIfExist() {
  try {
    const content = await readFile(TOKEN_PATH)
    const credentials = JSON.parse(content)
    return google.auth.fromJSON(credentials)
  } catch (err) {
    return null
  }
}

/**
 * Serializes credentials to a file comptible with GoogleAUth.fromJSON.
 *
 * @param {OAuth2Client} client
 * @return {Promise<void>}
 */
async function saveCredentials(client) {
  const content = await readFile(CREDENTIALS_PATH)
  const keys = JSON.parse(content)
  const key = keys.installed || keys.web
  const payload = JSON.stringify({
    type: 'authorized_user',
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  })
  await fs.writeFile(TOKEN_PATH, payload)
}

/**
 * Load or request or authorization to call APIs.
 *
 */
async function authorize() {
  let client = await loadSavedCredentialsIfExist()
  if (client) {
    return client
  }
  client = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  });
  if (client.credentials) {
    await saveCredentials(client)
  }
  return client
}

/**
 * Downloads a file from Google Drive.
 * @param {OAuth2Client} authClient An authorized OAuth2 client.
 * @param {string} fileId The ID of the file to download.
 * @param {string} fileName The name to save the file with.
 */
async function downloadFile(authClient, fileId, fileName) {
  const drive = google.drive({ version: 'v3', auth: authClient })
  const fileMetadata = await drive.files.get({ fileId })

  if(fileMetadata.data.mimeType.includes('application/vnd.google-apps.folder')) {
    const folderName = fileMetadata.data.name
    const folderPath = join(DOWNLOAD_PATH, folderName)

    try {
      await access(folderName, constants.F_OK)
      console.log(`Folder ${folderName} already exists at ${folderPath}`)
    } catch (error) {
      // If the folder doesn't exist, create it
      try {
        await mkdir(folderPath)
        console.log(`Folder ${folderName} created at ${folderPath}`)
      } catch (err) {
        console.error(`Error creating folder ${folderName}:`, err)
      }
    }
  } else if(fileMetadata.data.mimeType.includes("application/vnd.google-apps")) {
    const destPath = join(DOWNLOAD_PATH, fileName + '.pdf')

    try {
      await access(destPath, constants.F_OK)
      console.log(`File ${fileName} already exists at ${destPath}`)
    } catch (error) {
      // If the file doesn't exist, download it
      try {
        await drive.files.export({ fileId, mimeType: 'application/pdf' }, { responseType: 'stream' })
          .then(response => response.data.pipe(createWriteStream(destPath)))
          .catch(error => console.error(`Error exporting file ${fileName} as PDF:`, error))
  
        console.log(`File ${fileName} exported as PDF to ${destPath}`)
      } catch (err) {
        console.error(`Error getting file ${fileName}:`, err)
      }
    }
  } else {
    const destPath = join(DOWNLOAD_PATH, fileName)
    const destStream = createWriteStream(destPath)

    try {
      await access(destPath, constants.F_OK)
      console.log(`File ${fileName} already exists at ${destPath}`)
    } catch (error) {
      try {
        // If the file doesn't exist, download it
        const response = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' })
        await new Promise((resolve, reject) => {
          response.data
            .on('end', () => {
              console.log(`File ${fileName} downloaded to ${destPath}`)
              resolve()
            })
            .on('error', (err) => {
              console.error(`Error downloading file ${fileName}:`, err)
              reject(err)
            })
            .pipe(destStream)
        })
      } catch (err) {
        console.error(`Error getting file ${fileName}:`, err)
      }
    }
  }
}

/**
 * Lists the names and IDs of up to 10 files.
 * @param {OAuth2Client} authClient An authorized OAuth2 client.
 */
async function listFiles(authClient) {
  const drive = google.drive({ version: 'v3', auth: authClient })
  const res = await drive.files.list({
    q: `'1Svnuuj1kHuh9L74gJQWJ_pBP50N1Xweh' in parents`,
    pageSize: 10,
    fields: 'nextPageToken, files(id, name)',
  })
  const files = res.data.files
  if (files.length === 0) {
    console.log('No files found.')
    return
  }

  console.log('Files:');
  files.map(async (file) => {
    console.log(`${file.name} (${file.id})`)
    await downloadFile(authClient, file.id, file.name)
  })
}

authorize().then(listFiles).catch(console.error)