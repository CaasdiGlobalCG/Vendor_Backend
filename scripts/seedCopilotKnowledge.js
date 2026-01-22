import AWS from 'aws-sdk';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

console.log('🌱 [INIT] Starting copilot knowledge base seeding...');
console.log('📋 [CONFIG] AWS Region:', process.env.AWS_REGION || 'us-east-1');

const dynamoDB = new AWS.DynamoDB.DocumentClient({
  region: process.env.AWS_REGION || 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const COPILOT_KNOWLEDGE_TABLE = 'copilot_knowledge';

const KNOWLEDGE_BASE = [
  // Tasks Category
  {
    id: 'task-001',
    category: 'Tasks',
    question: 'How do I create a new task?',
    answer: 'To create a new task, look for the Tasks panel on the left sidebar. Click the \'+\' button next to "Tasks" or at the bottom of the task list. Enter the task name in the dialog that appears and click "Create". Your task will be added to the list immediately.',
    keywords: ['create', 'new', 'task', 'add', 'tasks'],
    followUpQuestions: ['How do I add subtasks?', 'How do I change task status?', 'Can I assign tasks to team members?']
  },
  {
    id: 'task-002',
    category: 'Tasks',
    question: 'How do I add a subtask?',
    answer: 'Click on a task to expand it and view its details. You\'ll see a "Subtasks" section with a \'+\' button. Click that button to add a new subtask. Enter the subtask name and click "Create". Subtasks help you break down larger tasks into smaller, manageable pieces.',
    keywords: ['subtask', 'sub-task', 'nested', 'add', 'child task'],
    followUpQuestions: ['How do I mark a subtask as complete?', 'Can I add multiple subtasks?', 'What is task hierarchy?']
  },
  {
    id: 'task-003',
    category: 'Tasks',
    question: 'How do I change task status?',
    answer: 'Each task has a status indicator (usually shown as a colored dot or icon). Click on the task to open it, and you\'ll see a status dropdown. Select from options like "Not Started", "In Progress", "Pending", or "Completed". The status helps track your workflow.',
    keywords: ['status', 'progress', 'complete', 'pending', 'change'],
    followUpQuestions: ['What status options are available?', 'Can I customize status types?']
  },
  {
    id: 'task-004',
    category: 'Tasks',
    question: 'Can I assign tasks to team members?',
    answer: 'Yes! Click on a task to open it. Look for an "Assign To" or "Team Member" field. Click it and select a team member from the dropdown. You can also mention team members using @username in task descriptions. Assigned team members will receive notifications about their tasks.',
    keywords: ['assign', 'team', 'member', 'delegate', 'ownership'],
    followUpQuestions: ['How do I see all my assigned tasks?', 'Can I assign multiple people to one task?']
  },
  {
    id: 'task-005',
    category: 'Tasks',
    question: 'How do I delete a task?',
    answer: 'Right-click on a task or click the three-dot menu icon next to it. Select "Delete" from the context menu. A confirmation dialog will appear - click "Confirm Delete" to remove the task permanently. Note: Deleting a task will also delete all its subtasks.',
    keywords: ['delete', 'remove', 'trash', 'discard'],
    followUpQuestions: ['Can I recover deleted tasks?', 'How do I archive tasks instead?']
  },
  
  // Elements Category
  {
    id: 'elem-001',
    category: 'Elements',
    question: 'What are Elements?',
    answer: 'Elements are visual components you can add to your workspace canvas. They can be shapes, text boxes, images, tables, or any design component. Elements help you organize and visualize your workspace content. You can drag, resize, style, and arrange elements to create your custom workspace design.',
    keywords: ['element', 'component', 'visual', 'object', 'shape'],
    followUpQuestions: ['How do I add an element?', 'What types of elements are available?', 'Can I customize element colors?']
  },
  {
    id: 'elem-002',
    category: 'Elements',
    question: 'How do I add an element to the workspace?',
    answer: 'Click on the "Elements" tab in the left sidebar. You\'ll see a list of available element types (Boxes, Text, Images, etc.). Click on the element type you want to add, then click on the canvas where you want to place it. The element will appear and you can then resize and customize it.',
    keywords: ['add', 'insert', 'element', 'create', 'new element'],
    followUpQuestions: ['What types of elements can I add?', 'How do I move elements?', 'Can I group elements?']
  },
  {
    id: 'elem-003',
    category: 'Elements',
    question: 'What types of elements are available?',
    answer: 'The workspace supports several element types: Boxes (rectangles), Text boxes, Images, Tables, Dividers, and Containers. Each type serves different purposes. Boxes are great for grouping, text boxes for labels, images for visual content, tables for data, and containers for complex layouts. Check the Elements panel to see all available types.',
    keywords: ['types', 'element', 'box', 'text', 'image', 'table'],
    followUpQuestions: ['How do I customize element appearance?', 'Can I add custom shapes?']
  },
  {
    id: 'elem-004',
    category: 'Elements',
    question: 'How do I move or resize elements?',
    answer: 'Click on an element to select it. You\'ll see resize handles around the edges. Drag the handles to resize the element. To move it, click and drag the element itself (not the handles). Hold Shift while dragging to snap to grid. Use arrow keys for fine positioning after selecting an element.',
    keywords: ['move', 'resize', 'drag', 'position', 'adjust'],
    followUpQuestions: ['How do I align elements?', 'Can I lock elements in place?', 'How do I distribute elements evenly?']
  },
  {
    id: 'elem-005',
    category: 'Elements',
    question: 'Can I customize element colors and styling?',
    answer: 'Yes! Select an element and look for the styling panel on the right sidebar. You can change: Background color, Border color and width, Text color (for text elements), Opacity, Shadow effects, and Rounded corners. Some elements have additional styling options. Colors can be set using the color picker or by entering hex codes.',
    keywords: ['color', 'style', 'customize', 'appearance', 'design'],
    followUpQuestions: ['How do I apply the same style to multiple elements?', 'Are there predefined color schemes?']
  },
  {
    id: 'elem-006',
    category: 'Elements',
    question: 'How do I delete an element?',
    answer: 'Click on the element to select it, then press Delete (or Backspace) on your keyboard. Alternatively, right-click the element and select "Delete" from the context menu. The element will be removed from the canvas immediately.',
    keywords: ['delete', 'remove', 'element', 'trash'],
    followUpQuestions: ['Can I undo a deletion?', 'How do I delete multiple elements at once?']
  },
  
  // Layouts Category
  {
    id: 'layout-001',
    category: 'Layouts',
    question: 'What are Layouts?',
    answer: 'Layouts are pre-designed templates that structure your workspace canvas. They define how elements are arranged and where tasks, elements, and messages are positioned. Using a layout saves time and ensures consistency. You can choose a layout when creating a workspace or apply a new layout to an existing workspace.',
    keywords: ['layout', 'template', 'structure', 'design'],
    followUpQuestions: ['How do I apply a layout?', 'Can I create custom layouts?']
  },
  {
    id: 'layout-002',
    category: 'Layouts',
    question: 'How do I apply a layout template?',
    answer: 'Click on the "Layouts" tab in the left sidebar to see available templates. Each layout shows a preview. Click on a layout to select it. A dialog will appear asking if you want to apply it to your workspace. Click "Apply" to implement the layout. Your existing elements will be rearranged according to the new layout structure.',
    keywords: ['apply', 'use', 'layout', 'template', 'select'],
    followUpQuestions: ['What happens to my existing elements when I change layouts?', 'How do I create a custom layout?']
  },
  {
    id: 'layout-003',
    category: 'Layouts',
    question: 'Can I create and save a custom layout?',
    answer: 'Yes! Arrange your elements and organize your workspace the way you like it. Click on "Layouts" and look for "Save Current as Layout" option. Give your layout a name and description. Your custom layout will be saved and you can apply it to other workspaces later. Custom layouts help maintain consistency across multiple projects.',
    keywords: ['custom', 'save', 'create', 'layout', 'template'],
    followUpQuestions: ['Can I share custom layouts with team members?', 'How do I edit a saved layout?']
  },
  {
    id: 'layout-004',
    category: 'Layouts',
    question: 'What layout options are best for different types of projects?',
    answer: 'The workspace offers layouts suited for: Project management (with task panels), Design collaboration (with canvas-focused layout), Team workflow (with message-first layout), Data visualization (with table-heavy layout), and Kanban boards (with column-based layout). Choose based on your project type and team workflow preferences.',
    keywords: ['project', 'best', 'type', 'layout', 'recommendation'],
    followUpQuestions: ['Which layout should I use for agile teams?', 'What layout works for creative projects?']
  },
  
  // Workspace Category
  {
    id: 'ws-001',
    category: 'Workspace',
    question: 'What is a Workspace?',
    answer: 'A Workspace is a collaborative project environment where team members can work together. Each workspace contains tasks, elements, messages, files, and a shared canvas. Workspaces can be used for projects, designs, planning, proposals, and any collaborative work. Team members can view, edit, and communicate within the workspace based on their permissions.',
    keywords: ['workspace', 'project', 'collaboration', 'environment'],
    followUpQuestions: ['How do I create a workspace?', 'How do I invite team members?', 'What are workspace permissions?']
  },
  {
    id: 'ws-002',
    category: 'Workspace',
    question: 'How do I create a new workspace?',
    answer: 'Click on the "New Workspace" or "Create Workspace" button on the dashboard. Fill in the workspace details: Name, Description (optional), and select a layout template. You can also set privacy settings (Private/Public). Click "Create" and your new workspace will be created. You\'ll be automatically added as the workspace owner.',
    keywords: ['create', 'new', 'workspace', 'start'],
    followUpQuestions: ['Can I copy an existing workspace?', 'How do I delete a workspace?']
  },
  {
    id: 'ws-003',
    category: 'Workspace',
    question: 'How do I invite team members to a workspace?',
    answer: 'Open your workspace and click on "Invite" or "Add Members" button (usually in the header). Enter the email addresses of team members you want to invite, one per line or separated by commas. You can set their role (Viewer, Editor, Admin). Click "Send Invites" and team members will receive an invitation email with a link to join the workspace.',
    keywords: ['invite', 'member', 'team', 'share', 'add'],
    followUpQuestions: ['What are the different member roles?', 'Can I change someone\'s role later?', 'How do I remove a team member?']
  },
  {
    id: 'ws-004',
    category: 'Workspace',
    question: 'What are workspace permissions and roles?',
    answer: 'Workspace has three main roles: Owner (full access, can manage all aspects), Admin (can edit, invite, and manage members), Editor (can view and edit content), and Viewer (can only view, read-only access). You can assign different roles to different team members based on their responsibilities. Permissions determine what actions users can perform in the workspace.',
    keywords: ['permission', 'role', 'access', 'owner', 'admin', 'editor', 'viewer'],
    followUpQuestions: ['How do I change someone\'s role?', 'Can I create custom roles?', 'What can viewers do?']
  },
  {
    id: 'ws-005',
    category: 'Workspace',
    question: 'How do I share a workspace with external collaborators?',
    answer: 'In workspace settings, look for "Sharing" or "Share" options. You can either: 1) Invite specific people via email, or 2) Generate a shareable link that you can send to anyone. Set whether the link allows Viewer or Editor access. External collaborators can access the workspace using the link without needing a full account.',
    keywords: ['share', 'external', 'collaborator', 'link', 'public'],
    followUpQuestions: ['Can I revoke a shareable link?', 'How do I limit external access?']
  },
  
  // Collaboration Category
  {
    id: 'collab-001',
    category: 'Collaboration',
    question: 'How do I communicate with team members?',
    answer: 'Use the Messages panel in your workspace. Type your message in the message input box and press Enter or click Send. You can mention team members using @username to notify them. Messages support formatted text, links, and file attachments. You can also reply to specific messages. All messages are logged in the conversation history.',
    keywords: ['message', 'communicate', 'chat', 'discuss', 'team'],
    followUpQuestions: ['How do I mention someone?', 'Can I pin important messages?', 'How do I search messages?']
  },
  {
    id: 'collab-002',
    category: 'Collaboration',
    question: 'How do I comment on tasks or elements?',
    answer: 'Click on a task or element to open its details panel. Look for a "Comments" section. Click "Add Comment" and type your feedback or discussion point. Other team members will be notified of new comments. Comments help keep discussions tied to specific items rather than getting lost in general chat.',
    keywords: ['comment', 'feedback', 'discuss', 'task', 'element'],
    followUpQuestions: ['Can I @mention people in comments?', 'How do I resolve a comment thread?']
  },
  {
    id: 'collab-003',
    category: 'Collaboration',
    question: 'How does real-time collaboration work?',
    answer: 'When multiple team members are in the same workspace, changes are synchronized in real-time. You can see cursor positions of other team members on the canvas. If someone moves an element, adds a task, or sends a message, you\'ll see the update immediately without needing to refresh. This enables true collaborative work without conflicts.',
    keywords: ['real-time', 'sync', 'collaboration', 'live', 'instant'],
    followUpQuestions: ['What happens if two people edit the same element?', 'Can I see who is currently in the workspace?']
  },
  {
    id: 'collab-004',
    category: 'Collaboration',
    question: 'How do I track who did what in the workspace?',
    answer: 'Click on "Activity" or "History" to view a timeline of all changes. You\'ll see who created tasks, modified elements, sent messages, and made other updates, along with timestamps. This helps track progress and understand the workspace evolution. You can also filter activity by type (Tasks, Elements, Messages, etc.) or by team member.',
    keywords: ['activity', 'history', 'track', 'changes', 'log', 'timeline'],
    followUpQuestions: ['Can I see version history of elements?', 'How far back does activity history go?']
  },
  
  // Files Category
  {
    id: 'file-001',
    category: 'Files',
    question: 'How do I upload files to the workspace?',
    answer: 'Click on the "Files" or "Assets" section in the left sidebar. Look for an "Upload" or "+" button. Click it and select files from your computer (images, PDFs, documents, etc.). You can upload single or multiple files at once. Uploaded files are stored in the workspace and accessible to all team members with appropriate permissions.',
    keywords: ['upload', 'file', 'asset', 'document', 'image'],
    followUpQuestions: ['What file types are supported?', 'What is the file size limit?', 'Can I organize files in folders?']
  },
  {
    id: 'file-002',
    category: 'Files',
    question: 'Can I embed files or images in the workspace?',
    answer: 'Yes! You can add an Image element to your canvas and set its source to an uploaded file. You can also add links to documents in task descriptions or messages. For PDFs, you can embed them as viewable components. This helps keep all project materials accessible within the workspace without external links.',
    keywords: ['embed', 'image', 'file', 'document', 'insert'],
    followUpQuestions: ['How do I resize embedded images?', 'Can I add image captions?']
  },
  {
    id: 'file-003',
    category: 'Files',
    question: 'How do I download or export files from the workspace?',
    answer: 'Right-click on a file in the Files section and select "Download". You can also export entire workspace content (as PDF, images, or ZIP) by going to Workspace Settings and selecting "Export". This helps you keep backups or share work outside the workspace.',
    keywords: ['download', 'export', 'save', 'backup'],
    followUpQuestions: ['Can I export the entire workspace as PDF?', 'What format are exports in?']
  },
  {
    id: 'file-004',
    category: 'Files',
    question: 'Can I version control my files?',
    answer: 'Yes! When you upload a new version of a file with the same name, the system keeps a history of previous versions. Right-click on a file and select "Version History" to see all versions with upload dates and who uploaded them. You can revert to previous versions if needed. This prevents accidental overwrites and helps track changes.',
    keywords: ['version', 'history', 'backup', 'previous', 'revert'],
    followUpQuestions: ['How many versions are kept?', 'Can I compare different versions?']
  },
  
  // Best Practices Category
  {
    id: 'bp-001',
    category: 'Best Practices',
    question: 'How should I organize tasks in a workspace?',
    answer: 'Use a clear naming convention for tasks (e.g., "[Feature] Description" or "[Bug] Issue"). Group related tasks together. Use subtasks to break down complex work. Assign clear owners to each task. Set realistic deadlines. Use status consistently. Regularly review and close completed tasks. This keeps your workspace clean and your team aligned.',
    keywords: ['organize', 'task', 'structure', 'naming', 'convention'],
    followUpQuestions: ['How do I prioritize tasks?', 'Should I use tags or labels?']
  },
  {
    id: 'bp-002',
    category: 'Best Practices',
    question: 'What is the best way to structure a workspace for a team?',
    answer: 'Define clear roles and permissions. Create workspaces by project (not by person). Use consistent layouts across similar projects. Establish naming conventions for tasks and elements. Create templates for recurring work. Document workspace guidelines for new team members. Regularly archive completed workspaces. This ensures consistency and makes onboarding easier.',
    keywords: ['structure', 'team', 'organization', 'workflow', 'template'],
    followUpQuestions: ['How do I create a workspace template?', 'What should I document for new members?']
  },
  {
    id: 'bp-003',
    category: 'Best Practices',
    question: 'How do I keep communication clear in a workspace?',
    answer: 'Use messages for general discussion, comments for specific feedback on tasks/elements. Keep discussions threaded and on-topic. Use @mentions to notify specific people. Archive old conversations periodically. Use clear, concise language. Include context when reporting issues. Establish response time expectations with your team. This prevents miscommunication and keeps focus.',
    keywords: ['communication', 'message', 'clear', 'discussion', 'thread'],
    followUpQuestions: ['Should we use comments or messages?', 'How do I handle off-topic discussions?']
  },
  {
    id: 'bp-004',
    category: 'Best Practices',
    question: 'How do I manage project progress effectively?',
    answer: 'Regularly update task statuses. Set milestone tasks. Use the Activity view to track progress. Have weekly check-ins to discuss blockers. Communicate clearly on completed vs. in-progress work. Document decisions in the workspace. Share progress updates with stakeholders. Celebrate completed milestones. This keeps everyone aligned and motivated.',
    keywords: ['progress', 'management', 'milestone', 'status', 'track'],
    followUpQuestions: ['How do I generate progress reports?', 'What metrics should I track?']
  },
  {
    id: 'bp-005',
    category: 'Best Practices',
    question: 'How do I maintain workspace quality and performance?',
    answer: 'Regularly clean up completed tasks and archive old elements. Remove unnecessary files. Update task descriptions when work changes. Keep element designs consistent. Remove duplicate elements and tasks. Unarchive only when needed. Optimize file sizes before uploading. This keeps the workspace performant and easier to navigate.',
    keywords: ['quality', 'performance', 'maintain', 'cleanup', 'optimize'],
    followUpQuestions: ['When should I archive items?', 'How do I clean up a messy workspace?']
  }
];

async function seedKnowledgeBase() {
  try {
    console.log('🌱 Starting to seed copilot knowledge base...');

    // First, check if table exists
    const dynamoDBSvc = new AWS.DynamoDB({
      region: process.env.AWS_REGION || 'us-east-1',
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    });

    try {
      await dynamoDBSvc.describeTable({ TableName: COPILOT_KNOWLEDGE_TABLE }).promise();
      console.log(`✅ Table "${COPILOT_KNOWLEDGE_TABLE}" exists`);
    } catch (error) {
      if (error.code === 'ResourceNotFoundException') {
        console.log(`📝 Table "${COPILOT_KNOWLEDGE_TABLE}" not found. Creating...`);
        
        await dynamoDBSvc.createTable({
          TableName: COPILOT_KNOWLEDGE_TABLE,
          KeySchema: [
            { AttributeName: 'id', KeyType: 'HASH' }
          ],
          AttributeDefinitions: [
            { AttributeName: 'id', AttributeType: 'S' }
          ],
          BillingMode: 'PAY_PER_REQUEST'
        }).promise();

        console.log(`✅ Table "${COPILOT_KNOWLEDGE_TABLE}" created`);
        
        // Wait longer for table to be fully ready
        console.log('⏳ Waiting for table to be fully active (5 seconds)...');
        await new Promise(resolve => setTimeout(resolve, 5000));
      } else {
        throw error;
      }
    }

    // Seed items
    let successCount = 0;
    let errorCount = 0;
    const failedItems = [];

    for (const item of KNOWLEDGE_BASE) {
      try {
        const params = {
          TableName: COPILOT_KNOWLEDGE_TABLE,
          Item: {
            id: item.id,
            category: item.category,
            question: item.question,
            answer: item.answer,
            keywords: item.keywords,
            followUpQuestions: item.followUpQuestions,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        };

        await dynamoDB.put(params).promise();
        successCount++;
        console.log(`✅ Seeded: ${item.question.substring(0, 50)}...`);
      } catch (error) {
        errorCount++;
        failedItems.push({ id: item.id, question: item.question, error: error.message });
        console.error(`❌ Error seeding ${item.id}:`, error.message);
      }
    }

    console.log(`\n📊 Seeding Complete!`);
    console.log(`✅ Successfully seeded: ${successCount} items`);
    console.log(`❌ Failed: ${errorCount} items`);
    console.log(`Total items in knowledge base: ${KNOWLEDGE_BASE.length}`);

    // If there were failures, suggest retrying
    if (failedItems.length > 0) {
      console.log(`\n⚠️  Failed items (usually due to table creation timing):`);
      failedItems.forEach(item => {
        console.log(`  • ${item.id}: ${item.question.substring(0, 40)}...`);
      });
      console.log(`\n💡 Tip: Run the script again to retry failed items.`);
      console.log(`   Usually passes on second run: node scripts/seedCopilotKnowledge.js\n`);
    }

    console.log(`\n🎉 Copilot knowledge base is ready to use!`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Fatal error during seeding:', error);
    process.exit(1);
  }
}

// Run the seeder with proper async handling
(async () => {
  try {
    await seedKnowledgeBase();
  } catch (error) {
    console.error('❌ [FATAL] Seeding failed:', error);
    process.exit(1);
  }
})();
