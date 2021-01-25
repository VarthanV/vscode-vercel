/* eslint-disable @typescript-eslint/naming-convention */
// 👆 because vercel API requires snake case keys

import * as polka from 'polka'
import * as qs from 'querystring'
import * as vscode from 'vscode'
import { nanoid } from 'nanoid'
import axios from 'axios'
import urlcat from 'urlcat'

import { Deployment, Team } from './models'
import { TokenManager } from './TokenManager'

class VercelApi {
  private static baseUrl = 'https://api.vercel.com'
  private static api(path?: string, query?: Record<string, string>) {
    return urlcat(this.baseUrl, path ?? '', query ?? {})
  }

  public static get oauth() {
    return {
      accessToken: this.api('/v2/oauth/access_token'),
      authorize: (query: Record<string, string>) =>
        this.api('/v2/oauth/authorize', query),
    }
  }

  public static get deployments() {
    return this.api('/v5/now/deployments')
  }

  public static get teams() {
    return this.api('/v1/teams')
  }
}

export class VercelManager {
  public onDidDeploymentsUpdated: () => void = () => {}
  public onDidTeamsUpdated: () => void = () => {}
  public onDidTeamsSelected: () => void = () => {}

  public constructor(private readonly token: TokenManager) {}

  public logIn() {
    const uuid = nanoid()
    const app = polka()

    app.get('/oauth/callback', async (req, res) => {
      const { code, state } = req.query as { code: string; state: string }

      if (!code || !state) {
        res.end('something went wrong')
        return
      }

      if (state !== uuid) {
        res.end('invalid authentication')
        return
      }

      try {
        const response = await axios.post<{ access_token: string }>(
          VercelApi.oauth.accessToken,
          qs.stringify({
            client_id: process.env.CLIENT_ID,
            client_secret: process.env.CLIENT_SECRET,
            code,
            redirect_uri: `http://localhost:${process.env.CALLBACK_PORT}/oauth/callback`,
          }),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
          }
        )

        if (response.data.access_token) {
          await this.token.setAuth(response.data.access_token)
          this.onDidDeploymentsUpdated()
          res.end('successfully authenticated! you can close this now')
        }
      } catch (e) {
        console.log(e)
        res.end('error exchanging access token')
      } finally {
        app.server?.close()
      }
    })

    app.listen(process.env.CALLBACK_PORT, (err: Error) => {
      if (err) {
        vscode.window.showErrorMessage(err.message)
      } else {
        vscode.commands.executeCommand(
          'vscode.open',
          vscode.Uri.parse(
            VercelApi.oauth.authorize({
              client_id: process.env.CLIENT_ID,
              state: uuid,
            })
          )
        )
      }
    })
  }

  async logOut() {
    await this.token.setAuth(undefined)
    await this.token.setTeam(undefined)

    this.onDidDeploymentsUpdated()
    this.onDidTeamsUpdated()
  }

  async getDeployments() {
    if (this.token.getAuth()) {
      const response = await axios.get<{ deployments: Array<Deployment> }>(
        urlcat(VercelApi.deployments, { teamId: this.selectedTeam }),
        {
          headers: {
            Authorization: `Bearer ${this.token.getAuth()}`,
          },
        }
      )
      return response.data
    } else {
      return { deployments: [] }
    }
  }

  async getTeams() {
    if (this.token.getAuth()) {
      const response = await axios.get<{ teams: Array<Team> }>(
        VercelApi.teams,
        {
          headers: {
            Authorization: `Bearer ${this.token.getAuth()}`,
          },
        }
      )
      return response.data
    } else {
      return { teams: [] }
    }
  }

  get selectedTeam() {
    return this.token.getTeam()
  }

  async switchTeam(id: string) {
    if (this.selectedTeam === id) {
      await this.token.setTeam(undefined)
    } else {
      await this.token.setTeam(id)
    }
    this.onDidTeamsSelected()
    this.onDidDeploymentsUpdated()
  }
}
