import * as DynamoPostService from '../models/DynamoPostService.js';
import * as DynamoNotification from '../models/DynamoNotification.js';
import * as WebSocket from '../../../websocket/notificationSocket.js';
import { getWorkspaceById } from '../../workspace/models/DynamoWorkspace.js'; // Import getWorkspaceById
import * as DynamoVendor from '../../vendor/models/DynamoVendor.js'; // Import vendor model
import * as DynamoUser from '../../../models/DynamoUser.js'; // Import user model
import { uploadFileToS3 } from '../utils/s3Upload.js'; // Import S3 upload utility

// Helper to extract mentions (@username) and hashtags (#department) from text
const parseMentionsAndHashtags = (text) => {
  // Updated regex to handle single-word mentions and hashtags (followed by space, end of string, or other triggers)
  const mentions = [...text.matchAll(/@([a-zA-Z0-9_]+)(?=\s|$|@|#)/g)].map(match => match[1].trim());
  const hashtags = [...text.matchAll(/#([a-zA-Z0-9_]+)(?=\s|$|@|#)/g)].map(match => match[1].trim());
  
  console.log('🔍 Parsing text:', text);
  console.log('📋 Found mentions:', mentions);
  console.log('📋 Found hashtags:', hashtags);
  
  return { mentions, hashtags };
};

// Helper to resolve mentions against workspace collaborators
const resolveMentionsAgainstCollaborators = async (mentions, workspaceId) => {
  const resolvedMentions = [];
  
  try {
    console.log(`🔍 Resolving mentions for workspace ${workspaceId}:`, mentions);
    
    // Get workspace details
    const workspace = await getWorkspaceById(workspaceId);
    console.log('📋 Workspace data:', workspace);
    
    if (!workspace || !workspace.sharedWith) {
      console.log('❌ No workspace or collaborators found');
      return resolvedMentions;
    }
    
    console.log('👥 Workspace collaborators:', workspace.sharedWith);

    // Get collaborator details
    const collaboratorDetails = [];
    for (const collaboratorId of workspace.sharedWith) {
      try {
        // Try to get vendor details first
        let collaborator = await DynamoVendor.getVendorById(collaboratorId);
        
        // If not found in vendors, try regular users
        if (!collaborator) {
          collaborator = await DynamoUser.getUserById(collaboratorId);
          if (collaborator) {
            // Convert user to collaborator format
            collaborator = {
              vendorId: collaborator.userId || collaborator.id,
              name: collaborator.name || collaborator.email?.split('@')[0] || 'User',
              email: collaborator.email,
              role: collaborator.role || 'vendor'
            };
          }
        }
        
        if (collaborator) {
          collaboratorDetails.push({
            id: collaborator.vendorId || collaborator.id,
            name: collaborator.name || collaborator.displayName || collaborator.email?.split('@')[0] || 'User',
            email: collaborator.email,
            role: collaborator.role || 'vendor'
          });
        }
      } catch (error) {
        console.error(`Error fetching collaborator ${collaboratorId}:`, error);
      }
    }

    // Match mentions against collaborator names
    for (const mention of mentions) {
      console.log(`🔍 Looking for mention: "${mention}"`);
      console.log(`📋 Available collaborators:`, collaboratorDetails.map(c => c.name));
      
      const matchedCollaborator = collaboratorDetails.find(collab => 
        collab.name.toLowerCase() === mention.toLowerCase()
      );
      
      if (matchedCollaborator) {
        console.log(`✅ Found match for "${mention}":`, matchedCollaborator);
        resolvedMentions.push({
          name: mention,
          userId: matchedCollaborator.id,
          email: matchedCollaborator.email,
          role: matchedCollaborator.role
        });
      } else {
        console.log(`❌ No match found for "${mention}"`);
      }
    }

    console.log(`Resolved mentions:`, resolvedMentions);
    return resolvedMentions;
  } catch (error) {
    console.error('Error resolving mentions against collaborators:', error);
    return resolvedMentions;
  }
};

// Create a new post service
export const createPostService = async (req, res) => {
  console.log('📝 Creating post service with data:', req.body);
  console.log('📎 Files received:', req.files);
  
  const { workspaceId, senderId, senderName, senderEmail, senderRole, content, subtaskId, taskId } = req.body;
  
  console.log('🔍 Post Service Context:', {
    workspaceId,
    subtaskId,
    taskId,
    senderId,
    senderName
  });

  if (!workspaceId || !senderId || !senderName || !senderEmail || !content) {
    console.log('❌ Missing required fields:', { workspaceId, senderId, senderName, senderEmail, content: !!content });
    return res.status(400).send({ message: 'Missing required fields for post service.' });
  }

  try {
    // Process file uploads first
    let uploadedAttachments = [];
    console.log('🔍 Checking for files in request...');
    console.log('📋 req.files:', req.files);
    console.log('📋 req.files length:', req.files ? req.files.length : 'NO FILES');
    console.log('📋 req.body keys:', Object.keys(req.body));
    
    if (req.files && req.files.length > 0) {
      console.log('📎 Processing file uploads...');
      console.log('📎 Files to process:', req.files.map(f => ({
        originalname: f.originalname,
        mimetype: f.mimetype,
        size: f.size,
        hasBuffer: !!f.buffer
      })));
      
      for (const file of req.files) {
        try {
          console.log('🔄 Processing file:', file.originalname);
          const uploadResult = await uploadFileToS3(file, workspaceId);
          uploadedAttachments.push({
            fileName: uploadResult.fileName,
            fileSize: uploadResult.fileSize,
            fileType: uploadResult.fileType,
            fileUrl: uploadResult.fileUrl,
            s3Key: uploadResult.s3Key,
            uniqueFileName: uploadResult.uniqueFileName
          });
          console.log('✅ File uploaded successfully:', uploadResult.fileName);
        } catch (uploadError) {
          console.error('❌ Error uploading file:', file.originalname, uploadError);
          // Continue with other files even if one fails
        }
      }
    } else {
      console.log('⚠️ No files found in request');
    }

    console.log('🔍 Parsing mentions and hashtags from content:', content);
    const { mentions, hashtags } = parseMentionsAndHashtags(content);
    console.log('📋 Parsed mentions:', mentions, 'hashtags:', hashtags);

    // Resolve mentions against workspace collaborators
    console.log('🔍 Resolving mentions against workspace collaborators...');
    const resolvedMentions = await resolveMentionsAgainstCollaborators(mentions, workspaceId);
    const mentionedUserIds = resolvedMentions.map(mention => mention.userId);
    console.log('✅ Resolved mentions:', resolvedMentions);

    // Resolve hashtags to relevant user groups (e.g., department roles)
    const hashtagRecipientIds = new Set();
    if (hashtags.length > 0) {
      console.log('🔍 Getting workspace for hashtag recipients...');
      const workspace = await getWorkspaceById(workspaceId);
      console.log('📋 Workspace data:', workspace);
      if (workspace && workspace.sharedWith) {
        // For hashtags, notify all collaborators in the workspace
        workspace.sharedWith.forEach(collabId => { 
          hashtagRecipientIds.add(collabId);
        });
        console.log('✅ Hashtag recipients:', Array.from(hashtagRecipientIds));
      }
    }

    const postData = {
      workspaceId,
      senderId,
      senderName,
      senderEmail,
      senderRole,
      content,
      subtaskId: subtaskId || null,
      taskId: taskId || null,
      attachments: uploadedAttachments, // Use uploaded attachments instead of req.body.attachments
      mentions: resolvedMentions.map(mention => mention.name), // Store mention names, not IDs
      hashtags,
    };

    console.log('💾 Creating post with data:', postData);
    const newPost = await DynamoPostService.createPostService(postData);
    console.log('✅ Post created successfully:', newPost);

    // Generate and send notifications
    const recipients = new Set([...mentionedUserIds, ...Array.from(hashtagRecipientIds)]);
    console.log('📢 Sending notifications to recipients:', Array.from(recipients));

    for (const userId of recipients) {
      try {
        const notificationMessage = `@${senderName} mentioned you or your department in a service post in workspace ${workspaceId}.`;
        console.log(`📨 Creating notification for user ${userId}:`, notificationMessage);
        
        const notification = await DynamoNotification.createNotification({
          userId,
          senderId,
          senderName,
          type: 'post_mention',
          message: notificationMessage,
          postId: newPost.postId,
          link: `/workspace/${workspaceId}/post/${newPost.postId}`,
        });
        
        console.log('✅ Notification created:', notification);
        
        // Send real-time notification via WebSocket
        WebSocket.sendNotificationToUser(userId, notification);
        console.log('📡 WebSocket notification sent to user:', userId);
      } catch (notificationError) {
        console.error(`❌ Failed to send notification to user ${userId}:`, notificationError);
        // Continue with other notifications even if one fails
      }
    }

    console.log('🎉 Post service creation completed successfully');
    res.status(201).send(newPost);
  } catch (error) {
    console.error('Failed to create post service:', error);
    res.status(500).send({ message: 'Failed to create post service.', error: error.message });
  };
};

// Create a reply to a post
export const createReply = async (req, res) => {
  console.log('💬 Creating reply with data:', req.body);
  console.log('📎 Reply files received:', req.files);
  
  const { workspaceId, senderId, senderName, senderEmail, senderRole, content, parentPostId, subtaskId, taskId } = req.body;
  
  console.log('🔍 Reply Context:', {
    workspaceId,
    subtaskId,
    taskId,
    parentPostId,
    senderId,
    senderName
  });

  if (!workspaceId || !senderId || !senderName || !senderEmail || !content || !parentPostId) {
    console.log('❌ Missing required fields for reply:', { workspaceId, senderId, senderName, senderEmail, content: !!content, parentPostId });
    return res.status(400).send({ message: 'Missing required fields for reply.' });
  }

  try {
    // Process file uploads first
    let uploadedAttachments = [];
    if (req.files && req.files.length > 0) {
      console.log('📎 Processing reply file uploads...');
      for (const file of req.files) {
        try {
          const uploadResult = await uploadFileToS3(file, workspaceId, parentPostId);
          uploadedAttachments.push({
            fileName: uploadResult.fileName,
            fileSize: uploadResult.fileSize,
            fileType: uploadResult.fileType,
            fileUrl: uploadResult.fileUrl,
            s3Key: uploadResult.s3Key,
            uniqueFileName: uploadResult.uniqueFileName
          });
          console.log('✅ Reply file uploaded successfully:', uploadResult.fileName);
        } catch (uploadError) {
          console.error('❌ Error uploading reply file:', file.originalname, uploadError);
          // Continue with other files even if one fails
        }
      }
    }

    console.log('🔍 Parsing mentions and hashtags from reply content:', content);
    const { mentions, hashtags } = parseMentionsAndHashtags(content);
    console.log('📋 Parsed mentions:', mentions, 'hashtags:', hashtags);

    // Resolve mentions against workspace collaborators
    console.log('🔍 Resolving mentions against workspace collaborators...');
    const resolvedMentions = await resolveMentionsAgainstCollaborators(mentions, workspaceId);
    const mentionedUserIds = resolvedMentions.map(mention => mention.userId);
    console.log('✅ Resolved mentions:', resolvedMentions);

    const replyData = {
      senderId,
      senderName,
      senderEmail,
      senderRole,
      content,
      attachments: uploadedAttachments, // Use uploaded attachments instead of req.body.attachments
      mentions: resolvedMentions.map(mention => mention.name),
      hashtags,
    };

    console.log('💾 Adding reply to post with data:', replyData);
    const updatedPost = await DynamoPostService.addReplyToPost(workspaceId, parentPostId, replyData);
    console.log('✅ Reply added successfully to post:', updatedPost);

    // Generate and send notifications for mentions
    if (mentionedUserIds.length > 0) {
      console.log('📢 Sending notifications to mentioned users:', mentionedUserIds);

      for (const userId of mentionedUserIds) {
        try {
          const notificationMessage = `@${senderName} mentioned you in a reply to a service post in workspace ${workspaceId}.`;
          console.log(`📨 Creating notification for user ${userId}:`, notificationMessage);
          
          const notification = await DynamoNotification.createNotification({
            userId,
            senderId,
            senderName,
            type: 'reply_mention',
            message: notificationMessage,
            postId: newReply.postId,
            link: `/workspace/${workspaceId}/post/${parentPostId}`,
          });
          
          console.log('✅ Notification created:', notification);
          
          // Send real-time notification via WebSocket
          WebSocket.sendNotificationToUser(userId, notification);
          console.log('📡 WebSocket notification sent to user:', userId);
        } catch (notificationError) {
          console.error(`❌ Failed to send notification to user ${userId}:`, notificationError);
        }
      }
    }

    console.log('🎉 Reply creation completed successfully');
    res.status(201).send(updatedPost);
  } catch (error) {
    console.error('Failed to create reply:', error);
    res.status(500).send({ message: 'Failed to create reply.', error: error.message });
  }
};

// Get post services for a workspace
export const getPostServices = async (req, res) => {
  const { workspaceId } = req.params;
  const { limit, lastEvaluatedKey } = req.query;

  if (!workspaceId) {
    return res.status(400).send({ message: 'Workspace ID is required.' });
  }

  try {
    const result = await DynamoPostService.getPostServicesByWorkspace(workspaceId, parseInt(limit), lastEvaluatedKey);
    res.status(200).send(result);
  } catch (error) {
    console.error('Failed to get post services:', error);
    res.status(500).send({ message: 'Failed to retrieve post services.', error: error.message });
  };
};

// Get post services for a specific subtask
export const getPostServicesBySubtask = async (req, res) => {
  const { workspaceId, subtaskId } = req.params;
  const { limit, lastEvaluatedKey } = req.query;

  if (!workspaceId || !subtaskId) {
    return res.status(400).send({ message: 'Workspace ID and Subtask ID are required.' });
  }

  try {
    console.log(`🔍 Getting post services for subtask ${subtaskId} in workspace ${workspaceId}`);
    const result = await DynamoPostService.getPostServicesBySubtask(workspaceId, subtaskId, parseInt(limit), lastEvaluatedKey);
    console.log(`✅ Found ${result.posts.length} posts for subtask ${subtaskId}`);
    res.status(200).send(result);
  } catch (error) {
    console.error('Failed to get post services by subtask:', error);
    res.status(500).send({ message: 'Failed to get post services by subtask.', error: error.message });
  }
};
