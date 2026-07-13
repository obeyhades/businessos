import type {
  Activity,
  Comment,
  Customer,
  CustomerContact,
  FileAttachment,
  Project,
  Task,
  User,
} from '@businessos/db';
import type {
  ActivityDto,
  ActivityType,
  AttachmentDto,
  CommentDto,
  ContactDto,
  CustomerDto,
  ProjectDto,
  TaskDto,
} from '@businessos/types';

type MiniUser = Pick<User, 'id' | 'name'>;
type MiniRef = { id: string; name: string };

function miniUser(user: MiniUser | null): { id: string; name: string } | null {
  return user ? { id: user.id, name: user.name } : null;
}

export function toCustomerDto(customer: Customer): CustomerDto {
  return {
    id: customer.id,
    name: customer.name,
    orgNumber: customer.orgNumber,
    email: customer.email,
    phone: customer.phone,
    addressLine1: customer.addressLine1,
    addressLine2: customer.addressLine2,
    postalCode: customer.postalCode,
    city: customer.city,
    country: customer.country,
    notes: customer.notes,
    status: customer.status,
    createdAt: customer.createdAt.toISOString(),
    updatedAt: customer.updatedAt.toISOString(),
  };
}

export function toContactDto(contact: CustomerContact): ContactDto {
  return {
    id: contact.id,
    customerId: contact.customerId,
    name: contact.name,
    email: contact.email,
    phone: contact.phone,
    title: contact.title,
    isPrimary: contact.isPrimary,
    createdAt: contact.createdAt.toISOString(),
    updatedAt: contact.updatedAt.toISOString(),
  };
}

export function toProjectDto(project: Project & { customer: MiniRef | null }): ProjectDto {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    status: project.status,
    customer: project.customer ? { id: project.customer.id, name: project.customer.name } : null,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

export function toTaskDto(
  task: Task & {
    customer: MiniRef | null;
    project: MiniRef | null;
    assignee: MiniUser | null;
  },
): TaskDto {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
    customer: task.customer ? { id: task.customer.id, name: task.customer.name } : null,
    project: task.project ? { id: task.project.id, name: task.project.name } : null,
    assignee: miniUser(task.assignee),
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

export function toCommentDto(comment: Comment & { author: MiniUser | null }): CommentDto {
  return {
    id: comment.id,
    body: comment.body,
    author: miniUser(comment.author),
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
  };
}

export function toAttachmentDto(
  attachment: FileAttachment & { uploadedBy: MiniUser | null },
): AttachmentDto {
  return {
    id: attachment.id,
    fileName: attachment.fileName,
    contentType: attachment.contentType,
    size: attachment.size,
    uploadedBy: miniUser(attachment.uploadedBy),
    createdAt: attachment.createdAt.toISOString(),
  };
}

export function toActivityDto(activity: Activity & { actor: MiniUser | null }): ActivityDto {
  return {
    id: activity.id,
    type: activity.type as ActivityType,
    actor: miniUser(activity.actor),
    customerId: activity.customerId,
    projectId: activity.projectId,
    taskId: activity.taskId,
    metadata: (activity.metadata as Record<string, unknown> | null) ?? null,
    createdAt: activity.createdAt.toISOString(),
  };
}
