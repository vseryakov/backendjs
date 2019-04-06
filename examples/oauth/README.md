# Backendjs application

1. To install

        npm install

2. Update ect/config with OAuth credentials

   The callback url must use path /oauth/callback/provider
   where provider is github, google, ....

        app-github-callback-url=http://myhost/oauth/callback/github

3. Create a user for local authentication

        bksh -etc-dir $(pwd)/etc -account-add login admin secret admin -scramble 1

4. Run the app

        ./app.sh

5. Point browser to http://localhost:8000

# Authors
vlad

