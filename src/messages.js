// Utility functions to work with Watson Work messages

import * as util from 'util';
import * as graphql from './graphql';
import debug from 'debug';

// Setup debug log
const log = debug('watsonwork-weather-messages');

// Return message with the given id
export const message = (messageId, token, cb) => {
  log('Getting message %s', messageId);
  graphql.query(util.format(`
    {
      message(id: "%s") {
        id
        created
        createdBy {
          id
          extId
          email
          displayName
        }
        content
        annotations
      }
    }`, messageId),
    token, (err, res) => {
      if(err) {
        if(err.errors) {
          cb(null, {});
          return;
        }
        cb(err);
        return;
      }

      let message;
      try {
        // Expect a GraphQL result like this:
        // data: {
        //   message: {
        //     id: '...',
        //     contentType: 'text/html',
        //     content: 'text of the message',
        //     annotations: [...]
        //   }
        // }

        message = res.data.message;
        // Parse annotations
        message.annotations = message.annotations.map((a) => JSON.parse(a));
      }
      catch(err) {
        log('Error getting message %o', err);
        cb(null, {});
        return;
      }

      // Return message
      // log('Message %s',
      //  util.inspect(message, { colors: debug.useColors(), depth: 10 }));
      cb(null, message);
    });
};

// Send a message to the conversation in a space
export const sendToSpace = (spaceId,
  title, text, actor, token, cb) => {
  log('Sending title %s text %s to space %s', title, text, spaceId);

  graphql.query(
    // Generate message template mutation
    util.format(`
      mutation {
        createMessage(input: {
          conversationId: "%s"
          annotations: [
            {
              genericAnnotation: {
                title: "%s"
                text: "%s"
                color: "#6CB7FB"
                actor: {
                  name: "%s"
                }
              }
            }
          ]
        }) {
          message {
            id
          }
        }
      }`, spaceId, title, text, actor),
    token, (err, res) => {
      if(err) {
        log('Error sending message %o', err);
        if(cb)
          cb(err);
        return;
      }
      log('Send result %s',
        util.inspect(res, { colors: debug.useColors(), depth: 10 }));
      if(cb)
        cb(null, res);
    });
};

// Send a message to a private action dialog
export const sendToPrivateDialog = (spaceId, userId, dialogId,
  title, text, actor, buttons, token, cb) => {
  log('Sending title %s text %s to space %s user %s dialog %s',
    title, text, spaceId, userId, dialogId);

  graphql.query(
    // Generate message template mutation
    util.format(`
      mutation {
        createTargetedMessage(input: {
          conversationId: "%s"
          targetUserId: "%s"
          targetDialogId: "%s" 
          annotations: [
            {
              genericAnnotation: {
                title: "%s"
                text: "%s"
                color: "#6CB7FB"
                actor: {
                  name: "%s"
                }
                buttons: [ %s ]
              }
            }

          ]
        }) {
          successful
        }
      }`, spaceId, userId, dialogId, title, text, actor,

        // Generate postback buttons
        (buttons || []).map((b) => util.format(`{
          postbackButton: {
            id: "%s",
            title: "%s",
            style: %s
          }
        }`, b[0], b[1], b[2] || 'PRIMARY')).join(',')),

    token, (err, res) => {
      if(err) {
        log('Error sending message %o', err);
        if(cb)
          cb(err);
        return;
      }
      log('Send result %s',
        util.inspect(res, { colors: debug.useColors(), depth: 10 }));
      if(cb)
        cb(null, res);
    });
};

