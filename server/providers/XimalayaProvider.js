const axios = require('axios')
const Logger = require('../Logger')

class XimalayaProvider {
  #responseTimeout = 30000
  #detailTimeout = 15000
  #baseSearchUrl = 'https://www.ximalaya.com/revision/search/main'
  #baseAlbumUrl = 'https://www.ximalaya.com/revision/album/v1/getTracksList'
  #coverBaseUrl = 'https://imagev2.xmcdn.com'

  constructor() {}

  /**
   * Build full cover URL from relative path
   * @param {string} coverPath
   * @returns {string|null}
   */
  buildCoverUrl(coverPath) {
    if (!coverPath) return null
    if (coverPath.startsWith('http')) return coverPath
    return `${this.#coverBaseUrl}/${coverPath}`
  }

  /**
   * Parse duration string to minutes (e.g. "02:30:00" -> 150)
   * @param {string} durationStr
   * @returns {number|null}
   */
  parseDuration(durationStr) {
    if (!durationStr) return null
    const parts = durationStr.split(':').map(Number)
    if (parts.length === 3) {
      return parts[0] * 60 + parts[1] + Math.round(parts[2] / 60)
    } else if (parts.length === 2) {
      return parts[0] + Math.round(parts[1] / 60)
    }
    return null
  }

  /**
   * Clean HTML tags from description
   * @param {string} html
   * @returns {string}
   */
  cleanDescription(html) {
    if (!html) return ''
    return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()
  }

  /**
   * Search Ximalaya albums by keyword
   * @param {string} query
   * @param {number} timeout
   * @returns {Promise<Object[]>}
   */
  async searchAlbums(query, timeout = this.#responseTimeout) {
    if (!timeout || isNaN(timeout)) timeout = this.#responseTimeout

    const url = `${this.#baseSearchUrl}?core=all&kw=${encodeURIComponent(query)}&page=1&spellchecker=true&rows=20&condition=relation&device=iPhone`
    Logger.debug(`[XimalayaProvider] Search url: ${url}`)

    try {
      const res = await axios.get(url, {
        timeout,
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
          'Accept': 'application/json, text/plain, */*',
          'Referer': 'https://www.ximalaya.com/'
        }
      })

      if (!res?.data?.data?.result?.response?.docs) {
        Logger.debug('[XimalayaProvider] No search results found')
        return []
      }

      const docs = res.data.data.result.response.docs
      const albums = []

      for (const doc of docs) {
        // Only process album type results
        if (doc.category !== 'album' && doc.category !== 'user') continue

        const albumId = doc.id
        const title = doc.title
        const anchorName = doc.anchorName || doc.nickname || ''
        const coverPath = doc.coverPath || doc.cover_path || ''
        const intro = doc.intro || doc.introduction || ''
        const createDate = doc.createDate || doc.created_at || ''
        const tracksCount = doc.tracksCount || doc.tracks_counts || 0

        if (!albumId || !title) continue

        albums.push({
          id: albumId,
          title: this.cleanDescription(title),
          author: anchorName,
          narrator: anchorName,
          cover: this.buildCoverUrl(coverPath),
          description: this.cleanDescription(intro),
          publishedYear: createDate ? createDate.split('-')[0] : null,
          tracksCount: Number(tracksCount) || 0,
          source: 'ximalaya'
        })
      }

      return albums
    } catch (error) {
      Logger.error('[XimalayaProvider] Search error:', error.message)
      return []
    }
  }

  /**
   * Get album detail to extract duration info
   * @param {string} albumId
   * @param {number} timeout
   * @returns {Promise<Object|null>}
   */
  async getAlbumDetail(albumId, timeout = this.#detailTimeout) {
    if (!timeout || isNaN(timeout)) timeout = this.#responseTimeout

    const url = `${this.#baseAlbumUrl}?albumId=${albumId}&pageNum=1&pageSize=1`
    Logger.debug(`[XimalayaProvider] Album detail url: ${url}`)

    try {
      const res = await axios.get(url, {
        timeout,
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
          'Accept': 'application/json, text/plain, */*',
          'Referer': `https://www.ximalaya.com/album/${albumId}`
        }
      })

      if (!res?.data?.data?.tracksAudioPlay?.length) {
        return null
      }

      const track = res.data.data.tracksAudioPlay[0]
      const albumInfo = res.data.data.mainInfo || {}

      return {
        duration: track.duration ? Math.round(track.duration / 60) : null,
        richIntro: albumInfo.richIntro || albumInfo.intro || ''
      }
    } catch (error) {
      Logger.error('[XimalayaProvider] Album detail error:', error.message)
      return null
    }
  }

  /**
   * Search for a book by title and author
   * @param {string} title
   * @param {string} author
   * @param {number} [timeout] response timeout in ms
   * @returns {Promise<Object[]>}
   **/
  async search(title, author, timeout = this.#responseTimeout) {
    if (!timeout || isNaN(timeout)) timeout = this.#responseTimeout

    let query = title || ''
    if (author && !query.includes(author)) {
      query += ` ${author}`
    }

    const albums = await this.searchAlbums(query.trim(), timeout)
    if (!albums.length) return []

    // Enhance album info with duration
    const enhancedAlbums = await Promise.all(
      albums.slice(0, 10).map(async (album) => {
        const detail = await this.getAlbumDetail(album.id, timeout)
        if (detail) {
          album.duration = detail.duration
          if (detail.richIntro && detail.richIntro.length > album.description?.length) {
            album.description = this.cleanDescription(detail.richIntro)
          }
        }
        return album
      })
    )

    return enhancedAlbums.filter((a) => a.title)
  }
}

module.exports = XimalayaProvider
