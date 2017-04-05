// A sample app that listens to messages posted to a space in IBM
// Watson Workspace and implements actions that return the weather.

import express from 'express';
import * as util from 'util';
import * as bparser from 'body-parser';
import * as http from 'http';
import * as https from 'https';
import * as oauth from './oauth';
import * as ssl from './ssl';
import * as sign from './sign';
import * as messages from './messages';
import * as events from './events';
import * as state from './state';
import * as twc from './weather';
import debug from 'debug';

// Setup debug log
const log = debug('watsonwork-weather-app');

// Handle events sent to the Weather action Webhook at /weather
export const weather = (appId, store, wuser, wpassword, token) =>
  (req, res) => {
    log('Received body %o', req.body);

    // Get the space containing the conversation that generated the event
    const spaceId = req.body.spaceId;

    // A utility function that sends a response message back to the
    // conversation in that space
    const sendToSpace = (response) => {
      messages.sendToSpace(spaceId,
        response.title, response.text, response.actor, token());
    };

    // Respond to the Webhook right away, as any response messages will
    // be sent asynchronously
    res.status(201).end();

    // Handle identified actions
    events.onActionIdentified(req.body, appId, token,
      (action, message, focus, user) => {
        log('Identified action %s', action);
        log('Message from user %o', user);
        log('Focus message %s', util.inspect(message,
          { colors: debug.useColors(), depth: 10 }));
        log('Focus annotation %s', util.inspect(focus,
          { colors: debug.useColors(), depth: 10 }));
      });

    // Handle selected actions
    events.onActionSelected(req.body, appId, token,
      (action, message, focus, selection, user) => {
        log('Selected action %s', action);
        log('Selected by user %o', user);
        log('Focus message %s', util.inspect(message,
          { colors: debug.useColors(), depth: 10 }));
        log('Focus annotation %s', util.inspect(focus,
          { colors: debug.useColors(), depth: 10 }));
        log('Selection annotation %s', util.inspect(selection,
          { colors: debug.useColors(), depth: 10 }));

        // A utility function that sends a message back to the selected
        // action dialog
        const sendToPrivateDialog = (response) => {
          messages.sendToPrivateDialog(
            spaceId, user.id, selection.targetDialogId,
            response.title, response.text, response.actor, response.buttons,
            token());
        };

        // Run with any previously saved action state
        state.run(spaceId, user.id, store, (astate, cb) => {

          // Remember the action being requested and the message that
          // requested it
          astate.message = message;
          astate.action = action;

          // Look for a city in the request
          const city = cityAndState(focus.extractedInfo.entities);

          // Remember the city
          astate.city = city;

          if(action === 'Get_Weather_Conditions') {
            // Get the weather conditions
            twc.conditions(city,
              wuser, wpassword, (err, conditions) => {
                if(err) {
                  sendToPrivateDialog(weatherError());
                  return;
                }
                if(!conditions.geo && conditions.geo.city) {
                  // Tell the user that the given city couldn't be found
                  sendToPrivateDialog(cityNotFound(astate.city));
                  return;
                }

                // Return the weather conditions
                sendToPrivateDialog(privateWeatherConditions(conditions));

                // Remember the weather conditions, in case the user
                // would like to share with the space later
                astate.conditions = conditions;

                cb(null, astate);
              });
            return;
          }

          if(action === 'Get_Weather_Forecast') {
            // Get a weather forecast
            twc.forecast5d(astate.city,
              wuser, wpassword, (err, forecast) => {
                if(err) {
                  sendToPrivateDialog(weatherError());
                  return;
                }
                if(!forecast.geo && forecast.geo.city) {
                  // Tell the user that the given city couldn't be found
                  sendToPrivateDialog(cityNotFound(astate.city));
                  return;
                }

                // Return weather forecast
                sendToPrivateDialog(privateWeatherForecast(forecast));

                // Remember the weather forecast, in case the user
                // would like to share with the space later
                astate.forecast = forecast;

                cb(null, astate);
              });
            return;
          }

          if(action === 'Dont_Share') {
            // Say that nothing will be shared with the space
            sendToPrivateDialog(notSharing());
            cb(null, astate);
            return;
          }

          if(action === 'Share_Weather_Conditions') {
            // Share the weather conditions with the space
            sendToSpace(sharedWeatherConditions(user, astate.conditions));
            sendToPrivateDialog(shared());
            cb(null, astate);
            return;
          }

          if(action === 'Share_Weather_Forecast') {
            // Share the weather forecast with the space
            sendToSpace(sharedWeatherForecast(user, astate.forecast));
            sendToPrivateDialog(shared());
            cb(null, astate);
            return;
          }

          cb(null, astate);
        });
      });
  };

// Extract and combine city and state from a list of NL entities
const cityAndState = (entities) => {
  const city =
    (entities.filter((e) => e.type === 'City')[0] || {}).text;
  const cacity =
    (entities.filter((e) => e.type === 'CA-City')[0] || {}).text;
  if(!city && !cacity)
    return undefined;
  const state =
    (entities.filter((e) => e.type === 'StateOrCounty')[0] || {}).text;
  return city && state ? [city, state].join(', ') :
    cacity ? [cacity, 'CA'].join(', ') :
    city;
};

// The various messages the application sends

// Weather conditions
const weatherConditionsText = (w) => 
  util.format('%s\\n%sF Feels like %sF\\n%s%s',
    [w.geo.city, w.geo.adminDistrictCode].join(', '),
    w.observation.temp,
    w.observation.feels_like,
    w.observation.wx_phrase,
    w.observation.terse_phrase ?
      '. ' + w.observation.terse_phrase : '');

const privateWeatherConditions = (w) => ({
  title: util.format('Here are the Weather conditions in %s. ' +
    'Would you like to share this with the space?',
    [w.geo.city, w.geo.adminDistrictCode].join(', ')),
  text: weatherConditionsText(w),
  buttons: [
    ['Share_Weather_Conditions', 'Yes, Share with Space', 'PRIMARY'],
    ['Dont_Share', 'No, Thanks', 'SECONDARY']
  ]
});

const sharedWeatherConditions = (user, w) => ({
  title: util.format('Weather conditions in %s.',
    [w.geo.city, w.geo.adminDistrictCode].join(', ')),
  text: weatherConditionsText(w),
  actor: user.displayName
});

// Weather forecast
const weatherForecastText = (w) =>
  util.format('%s%s',
    [w.geo.city, w.geo.adminDistrictCode].join(', '),
    w.forecasts.reduce((a, f) => a +
      util.format('\\n%s %sF %sF %s',
        f.dow.slice(0, 3),
        f.max_temp || '--', f.min_temp || '--',
        f.narrative.split('.')[0]),
      ''));

const privateWeatherForecast = (w) => ({
  title: util.format('Here\'s the Weather forecast for %s. ' +
    'Would you like to share this with the space?',
    [w.geo.city, w.geo.adminDistrictCode].join(', ')),
  text: weatherForecastText(w),
  buttons: [
    ['Share_Weather_Forecast', 'Yes, Share with Space', 'PRIMARY'],
    ['Dont_Share', 'No, Thanks', 'SECONDARY']
  ]
});

const sharedWeatherForecast = (user, w) => ({
  title: util.format('Weather forecast for %s.',
    [w.geo.city, w.geo.adminDistrictCode].join(', ')),
  text: weatherForecastText(w),
  actor: user.displayName
});

// Shared with the space
const shared = () => ({
  title: 'Your message was successfully shared with the space.',
  text: ' '
});

// Nothing will be shared
const notSharing = () => ({
  title: 'OK, nothing will be shared with the space.',
  text: ' '
});

// Missing city
const missingCity = () => ({
  title: 'I can get the weather for you but I need a city name.',
  text: 'You can say San Francisco, or San Diego for example.'
});

// City not found
const cityNotFound = (city) => ({
  title: util.format('I couldn\'t find %s, I need a valid city.', city),
  text: ' '
});

// Create Express Web app
export const webapp =
  (appId, secret, whsecret, store, wuser, wpassword, cb) => {
    // Authenticate the app and get an OAuth token
    oauth.run(appId, secret, (err, token) => {
      if(err) {
        cb(err);
        return;
      }

      // Return the Express Web app
      cb(null, express()

        // Configure Express route for the app Webhook
        .post('/weather',

          // Verify Watson Work request signature and parse request body
          bparser.json({
            type: '*/*',
            verify: sign.verify(whsecret)
          }),

          // Handle Watson Work Webhook challenge requests
          sign.challenge(whsecret),

          // Handle Watson Work Webhook events
          weather(appId, state.store(store), wuser, wpassword, token)));
    });
  };

// App main entry point
const main = (argv, env, cb) => {
  // Create Express Web app
  webapp(
    env.WEATHER_ACTIONS_APP_ID,
    env.WEATHER_ACTIONS_APP_SECRET,
    env.WEATHER_ACTIONS_WEBHOOK_SECRET,
    env.WEATHER_ACTIONS_STORE,
    env.WEATHER_TWC_USER,
    env.WEATHER_TWC_PASSWORD, (err, app) => {
      if(err) {
        cb(err);
        return;
      }

      if(env.PORT) {
        // In a hosting environment like Bluemix for example, HTTPS is
        // handled by a reverse proxy in front of the app, just listen
        // on the configured HTTP port
        log('HTTP server listening on port %d', env.PORT);
        http.createServer(app).listen(env.PORT, cb);
      }

      else
        // Listen on the configured HTTPS port, default to 443
        ssl.conf(env, (err, conf) => {
          if(err) {
            cb(err);
            return;
          }
          const port = env.SSLPORT || 443;
          log('HTTPS server listening on port %d', port);
          https.createServer(conf, app).listen(port, cb);
        });
    });
};

if (require.main === module)
  main(process.argv, process.env, (err) => {
    if(err) {
      console.log('Error starting app:', err);
      return;
    }
    log('App started');
  });

