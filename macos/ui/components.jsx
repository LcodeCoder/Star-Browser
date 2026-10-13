import React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { X, MoreHorizontal, Check, ChevronDown } from "lucide-react";
function Logo({ className = "" }) {
  return <svg className={"star-logo " + className} viewBox="0 0 48 48" aria-hidden="true"><rect x="2" y="2" width="44" height="44" rx="14" fill="currentColor" opacity=".09" /><path d="M24 9c1.8 9.4 5.6 13.2 15 15-9.4 1.8-13.2 5.6-15 15-1.8-9.4-5.6-13.2-15-15 9.4-1.8 13.2-5.6 15-15Z" fill="currentColor" /><circle cx="37" cy="11" r="3" fill="#fbbc04" /></svg>;
}
function Button({ children, variant = "", className = "", icon: Icon, ...props }) {
  return <button className={`button ${variant} ${className}`} {...props}>{Icon && <Icon size={16} />} {children}</button>;
}
function IconButton({ icon: Icon, label, className="", ...props }) {
  return <button className={"icon-button "+className} aria-label={label} title={label} {...props}><Icon size={17} /></button>;
}
function Modal({ open, onOpenChange, title, description, children, footer, wide = false, id, dismissible = true, returnFocus }) {
  const previousFocus=React.useRef(null),wasOpen=React.useRef(false);if(open&&!wasOpen.current)previousFocus.current=document.activeElement;wasOpen.current=open;
  return <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}><DialogPrimitive.Portal><DialogPrimitive.Overlay className="dialog-overlay" /><DialogPrimitive.Content className={"dialog-content" + (wide ? " wide" : "")} id={id} onCloseAutoFocus={event=>{const target=returnFocus||previousFocus.current;if(target?.isConnected&&target!==document.body){event.preventDefault();target.focus();}}} onEscapeKeyDown={e=>!dismissible&&e.preventDefault()} onPointerDownOutside={e=>!dismissible&&e.preventDefault()}><div className="dialog-header"><div><DialogPrimitive.Title className="dialog-title">{title}</DialogPrimitive.Title><DialogPrimitive.Description className="muted dialog-description">{description}</DialogPrimitive.Description></div><DialogPrimitive.Close asChild><IconButton icon={X} label="关闭" disabled={!dismissible} /></DialogPrimitive.Close></div><div className="dialog-body">{children}</div>{footer && <div className="dialog-footer">{footer}</div>}</DialogPrimitive.Content></DialogPrimitive.Portal></DialogPrimitive.Root>;
}
function Menu({ items, label = "更多操作", children }) {
  return <DropdownPrimitive.Root><DropdownPrimitive.Trigger asChild>{children || <IconButton icon={MoreHorizontal} label={label} />}</DropdownPrimitive.Trigger><DropdownPrimitive.Portal><DropdownPrimitive.Content className="dropdown-content" align="end" sideOffset={5}>{items.map((item, i) => item.separator ? <DropdownPrimitive.Separator key={i} className="dropdown-separator" /> : <DropdownPrimitive.Item key={i} className={"dropdown-item" + (item.danger ? " danger" : "")} disabled={item.disabled} onSelect={item.action}>{item.icon && <item.icon size={15} />}<span>{item.label}</span>{item.hint && <span className="shortcut">{item.hint}</span>}</DropdownPrimitive.Item>)}</DropdownPrimitive.Content></DropdownPrimitive.Portal></DropdownPrimitive.Root>;
}
function Tabs({ value, onValueChange, items }) {
  return <TabsPrimitive.Root value={value} onValueChange={onValueChange}><TabsPrimitive.List className="tabs-list">{items.map((item) => <TabsPrimitive.Trigger key={item.value} value={item.value} className="tabs-trigger">{item.label}</TabsPrimitive.Trigger>)}</TabsPrimitive.List>{items.map((item) => <TabsPrimitive.Content key={item.value} value={item.value} className="tabs-content">{item.content}</TabsPrimitive.Content>)}</TabsPrimitive.Root>;
}
function Field({ label, id, children, hint, className = "" }) {
  return <label className={"field " + className} htmlFor={id}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}
function Empty({ icon: Icon, title, description, children, action }) {
  return <div className="empty-state">{Icon && <div className="empty-icon"><Icon size={29} strokeWidth={1.5} /></div>}<h2>{title}</h2><p>{description}</p>{(children||action) && <div className="empty-actions">{children||action}</div>}</div>;
}
function Badge({ children, status = "" }) {
  return <span className={"status-badge " + status}>{status && <span className="status-dot" />}{children}</span>;
}
export {
  Badge,
  Button,
  Empty,
  Field,
  IconButton,
  Logo,
  Menu,
  Modal,
  Tabs
};
